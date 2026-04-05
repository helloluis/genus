import Phaser from "phaser";
import { COLORS } from "../utils/colors.js";
import { TEST_BOXES } from "../utils/testdata.js";
import type { BallData, BoxData } from "../utils/types.js";
import { startGame, syncPicks, fetchNextBox, isOfflineMode, submitDevFeedback } from "../api.js";

/** Always 16 badges in a 4×4 grid */
const GRID_COLS = 4;
const GRID_ROWS = 4;
const NUM_BADGES = GRID_COLS * GRID_ROWS;

/**
 * Exact hole centers measured from grid.png (2100×2100).
 * Spacings are non-uniform so we store each position explicitly as fractions.
 */
const HOLE_X = [363, 828, 1282, 1741].map((px) => px / 2100);
const HOLE_Y = [366, 823, 1286, 1744].map((px) => px / 2100);
const HOLE_RADIUS_FRAC = 192 / 2100;

interface BadgeObject {
  data: BallData;
  container: Phaser.GameObjects.Container;
  photo: Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text | null;
  selected: boolean;
  targetY: number; // final resting Y position
}

export class GameScene extends Phaser.Scene {
  private currentBoxIndex = 0;
  private currentBox!: BoxData;
  private badges: BadgeObject[] = [];
  private score = 0;
  private timerEvent!: Phaser.Time.TimerEvent;
  private timeRemaining = 0;
  private timerBar!: Phaser.GameObjects.Graphics;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private categoryText!: Phaser.GameObjects.Text;
  private helperText!: Phaser.GameObjects.Text;
  private gridSprite!: Phaser.GameObjects.Image;
  private gameOver = false;
  private transitioning = false;
  private paused = false;
  private useApi = !isOfflineMode();
  private pendingNextBox: BoxData | null = null;
  private correctTotal = 0;
  private correctFound = 0;
  private devMode = false;
  private lastSelectedBadge: BadgeObject | null = null;

  // Dev mode UI
  private devNextBtn!: Phaser.GameObjects.Container;
  private devFeedbackBtn!: Phaser.GameObjects.Container;

  // Grid positioning (computed on layout)
  private gridX = 0;
  private gridY = 0;
  private gridScale = 1;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { devMode?: boolean } = {}) {
    this.devMode = data.devMode ?? false;
  }

  async create() {
    this.currentBoxIndex = 0;
    this.score = 0;
    this.gameOver = false;
    this.transitioning = false;
    this.badges = [];
    this.pendingNextBox = null;
    this.correctFound = 0;
    (window as any).GENUS_RELOAD = () => this.scene.restart();

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(COLORS.background);

    // ── Compute grid position ──
    this.calculateGridLayout(width, height);

    // ── Grid sprite — FOREGROUND (badges sit behind it) ──
    this.gridSprite = this.add.image(this.gridX, this.gridY, "grid");
    this.gridSprite.setScale(this.gridScale);
    this.gridSprite.setDepth(50); // above badges

    // ── UI elements ──

    // Category title — above the grid
    const gridTop = this.gridY - (1050 * this.gridScale);
    this.categoryText = this.add
      .text(width / 2, Math.max(gridTop - 10, 15), "", {
        fontFamily: "Ranchers, cursive",
        fontSize: `${Math.min(42, Math.max(24, width * 0.05))}px`,
        color: COLORS.textDark,
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(100);

    // Score — top right
    this.scoreText = this.add
      .text(width - 16, 16, "Score: 0", {
        fontFamily: "Ranchers, cursive",
        fontSize: `${Math.min(20, Math.max(14, width * 0.025))}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
      })
      .setOrigin(1, 0)
      .setDepth(100);

    // Pause button — below score
    const pauseBtn = this.add
      .text(width - 16, 40, "⏸", {
        fontFamily: "Ranchers, cursive",
        fontSize: "24px",
        color: COLORS.textDark,
      })
      .setOrigin(1, 0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });

    pauseBtn.on("pointerdown", () => {
      this.paused = !this.paused;
      pauseBtn.setText(this.paused ? "▶" : "⏸");
    });

    // Helper caption — below the grid
    const gridBottom = this.gridY + (1050 * this.gridScale);
    this.helperText = this.add
      .text(width / 2, gridBottom + 20, "", {
        fontFamily: "Ranchers, cursive",
        fontSize: `${Math.min(26, Math.max(16, width * 0.032))}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setDepth(100);

    // Timer bar — at bottom
    this.timerBar = this.add.graphics().setDepth(100);
    this.timerText = this.add
      .text(width / 2, height - 12, "", {
        fontFamily: "Ranchers, cursive",
        fontSize: "15px",
        color: COLORS.textDark,
      })
      .setOrigin(0.5)
      .setDepth(100);

    // ── Dev mode buttons ──
    if (this.devMode) {
      this.createDevButtons();
    }

    // ── Load first box ──
    if (this.useApi) {
      try {
        const box = await startGame();
        this.loadBox(box);
      } catch (err) {
        console.warn("API unavailable, falling back to test data", err);
        this.useApi = false;
        this.loadBox(TEST_BOXES[0]);
      }
    } else {
      this.loadBox(TEST_BOXES[0]);
    }

    // Handle resize — restart is simplest for a full relayout
    this.scale.on("resize", () => {
      if (this.currentBox) this.scene.restart();
    });
  }

  // ── Layout ──────────────────────────────────────────────

  private calculateGridLayout(width: number, height: number) {
    // Reserve space: top for title (~10%), bottom for helper+timer (~15%)
    const availH = height * 0.75;
    const availW = width * 0.92;
    const gridDim = Math.min(availW, availH);

    this.gridScale = gridDim / 2100;
    this.gridX = width / 2;
    this.gridY = height * 0.1 + gridDim / 2; // top ~10% reserved for title
  }

  /** Get world position of the center of a grid hole at (row, col) */
  private getHoleCenter(row: number, col: number): { x: number; y: number } {
    const scaledSize = 2100 * this.gridScale;
    const topLeftX = this.gridX - scaledSize / 2;
    const topLeftY = this.gridY - scaledSize / 2;

    return {
      x: topLeftX + HOLE_X[col] * scaledSize,
      y: topLeftY + HOLE_Y[row] * scaledSize,
    };
  }

  /** Get the display radius of a hole in world pixels */
  private getHoleRadius(): number {
    return HOLE_RADIUS_FRAC * 2100 * this.gridScale;
  }

  // ── Box loading ─────────────────────────────────────────

  private loadBox(box: BoxData) {
    this.currentBox = box;
    this.timeRemaining = box.timeLimitMs;
    this.transitioning = false;
    this.correctFound = 0;

    // Clear old badges and their labels
    for (const badge of this.badges) {
      badge.container.destroy();
      if (badge.label) badge.label.destroy();
    }
    this.badges = [];

    // Count correct for helper text
    const badgesToShow = box.balls.slice(0, NUM_BADGES);
    this.correctTotal = badgesToShow.filter((b) => b.isCorrect).length;
    this.updateHelperText();

    // Preload images then show
    let needsLoad = false;
    for (const b of badgesToShow) {
      if (b.imageUrl) {
        const key = `ball_img_${b.id}`;
        if (!this.textures.exists(key)) {
          this.load.image(key, b.imageUrl);
          needsLoad = true;
        }
      }
    }

    const show = () => {
      // Flash question text large in grid center, then animate to top
      this.showQuestionIntro(box.categoryName, () => {
        this.createBadges(badgesToShow);
        if (this.timerEvent) this.timerEvent.destroy();
        if (!this.devMode) {
          this.timerEvent = this.time.addEvent({
            delay: 100,
            callback: this.tickTimer,
            callbackScope: this,
            loop: true,
          });
        } else {
          // Dev mode: hide timer, show static "DEV MODE" indicator
          this.timerBar.clear();
          this.timerText.setText("DEV MODE").setColor("#546e7a");
        }
      });
    };

    if (needsLoad) {
      this.load.once("complete", show);
      this.load.start();
    } else {
      show();
    }
  }

  private updateHelperText() {
    const remaining = this.correctTotal - this.correctFound;
    if (remaining <= 0) {
      this.helperText.setText("correct!");
    } else if (this.correctTotal === 1) {
      this.helperText.setText("find it!");
    } else if (remaining === 1) {
      this.helperText.setText("last one!");
    } else if (this.correctFound === 0) {
      this.helperText.setText(`find ${this.correctTotal}!`);
    } else {
      this.helperText.setText(`${remaining} to go!`);
    }
    this.helperText.setColor(COLORS.textDark);
  }

  // ── Question intro animation ─────────────────────────────

  private showQuestionIntro(text: string, onComplete: () => void) {
    const { width } = this.scale;

    // Big text in the center of the grid
    const bigSize = Math.min(64, Math.max(36, width * 0.07));
    const bigText = this.add
      .text(this.gridX, this.gridY, text, {
        fontFamily: "Ranchers, cursive",
        fontSize: `${bigSize}px`,
        color: "#ffffff",
        align: "center",
        stroke: "#000000",
        strokeThickness: 4,
        wordWrap: { width: width * 0.7 },
      })
      .setOrigin(0.5)
      .setDepth(200)
      .setAlpha(0)
      .setScale(0.5);

    // Animate in
    this.tweens.add({
      targets: bigText,
      alpha: 1,
      scale: 1,
      duration: 300,
      ease: "Back.easeOut",
      onComplete: () => {
        // Hold for a moment, then fade out and set the top category text
        this.time.delayedCall(600, () => {
          // Update the persistent category text at top
          this.categoryText.setText(text);

          // Animate big text out
          this.tweens.add({
            targets: bigText,
            alpha: 0,
            scale: 0.8,
            y: this.categoryText.y,
            duration: 300,
            ease: "Quad.easeIn",
            onComplete: () => {
              bigText.destroy();
              onComplete();
            },
          });
        });
      },
    });
  }

  // ── Badge creation ──────────────────────────────────────

  private createBadges(badgesData: BallData[]) {
    const holeRadius = this.getHoleRadius();
    const badgeRadius = holeRadius; // badge fills the hole exactly
    const photoRadius = badgeRadius * 0.88;

    for (let i = 0; i < badgesData.length && i < NUM_BADGES; i++) {
      const row = Math.floor(i / GRID_COLS);
      const col = i % GRID_COLS;
      const { x: cx, y: cy } = this.getHoleCenter(row, col);

      // Start position: above the grid, staggered by column
      const startY = this.gridY - (1050 * this.gridScale) - holeRadius * 2 - Math.random() * 60;

      const container = this.add.container(cx, startY).setDepth(10); // behind the grid

      // Badge disc — white circle
      const disc = this.add.graphics();
      disc.fillStyle(0xffffff, 1);
      disc.fillCircle(0, 0, badgeRadius);
      disc.lineStyle(2, 0xdddddd, 0.6);
      disc.strokeCircle(0, 0, badgeRadius);
      container.add(disc);

      // Photo
      let photo: Phaser.GameObjects.Image | null = null;
      const imageUrl = badgesData[i].imageUrl;
      if (imageUrl) {
        const textureKey = `ball_img_${badgesData[i].id}`;
        if (this.textures.exists(textureKey)) {
          photo = this.add.image(0, 0, textureKey);
          photo.setDisplaySize(photoRadius * 2, photoRadius * 2);

          // Circular mask
          const mask = this.add.graphics();
          mask.fillStyle(0xffffff);
          mask.fillCircle(cx, cy, photoRadius);
          photo.setMask(mask.createGeometryMask());
          // Store mask ref so we can update position if needed
          (photo as any)._genusMask = mask;
          (photo as any)._genusMaskCx = cx;
          (photo as any)._genusMaskCy = cy;

          container.add(photo);
        }
      }

      // Label on top of the grid — dynamically sized to fit
      let label: Phaser.GameObjects.Text | null = null;
      if (!this.currentBox.hideLabels || !photo) {
        const maxWidth = holeRadius * 2.2; // slightly wider than the hole
        const baseFontSize = Math.max(10, badgeRadius * 0.26);
        // Shrink font for longer labels to avoid truncation
        const len = badgesData[i].label.length;
        const fontSize = len > 14 ? baseFontSize * (14 / len) * 1.1 : baseFontSize;

        label = this.add
          .text(cx, cy + holeRadius + Math.max(fontSize, 10) * 0.4, badgesData[i].label, {
            fontFamily: "Ranchers, cursive",
            fontSize: `${Math.max(8, fontSize)}px`,
            color: "#ffffff",
            align: "center",
            stroke: "#000000",
            strokeThickness: 2,
            wordWrap: { width: maxWidth },
          })
          .setOrigin(0.5)
          .setDepth(60); // above grid (depth 50)
      }

      // Interactive hit area — circle matching the badge
      const hitZone = this.add.zone(0, 0, badgeRadius * 2, badgeRadius * 2);
      hitZone.setInteractive(
        new Phaser.Geom.Circle(badgeRadius, badgeRadius, badgeRadius),
        Phaser.Geom.Circle.Contains
      );
      container.add(hitZone);

      const badgeObj: BadgeObject = {
        data: badgesData[i],
        container,
        photo,
        label,
        selected: false,
        targetY: cy,
      };

      hitZone.on("pointerdown", () => this.onBadgeTap(badgeObj));

      // Hover
      hitZone.on("pointerover", () => {
        if (this.gameOver || this.transitioning) return;
        this.tweens.add({ targets: container, scale: 1.06, duration: 80, ease: "Quad.easeOut" });
      });
      hitZone.on("pointerout", () => {
        if (this.gameOver || this.transitioning) return;
        this.tweens.add({ targets: container, scale: 1.0, duration: 80, ease: "Quad.easeOut" });
      });

      // Drop animation — bottom row drops first, top row last
      const invertedRow = GRID_ROWS - 1 - row;
      this.tweens.add({
        targets: container,
        y: cy,
        duration: 350 + invertedRow * 60,
        delay: invertedRow * 120 + col * 40, // bottom row earliest, stagger columns
        ease: "Bounce.easeOut",
      });

      this.badges.push(badgeObj);
    }
  }

  // ── Input handling ─────────────────────────────────────

  private onBadgeTap(badge: BadgeObject) {
    if (this.gameOver || this.transitioning || badge.selected) return;

    badge.selected = true;
    this.lastSelectedBadge = badge;

    // Instant bounce feedback
    this.tweens.add({
      targets: badge.container,
      scale: 1.15,
      duration: 100,
      yoyo: true,
      ease: "Quad.easeOut",
    });

    // Sync pick to server in background (fire-and-forget)
    if (this.useApi) {
      syncPicks(this.badges.filter((b) => b.selected).map((b) => b.data.id));
    }

    if (badge.data.isCorrect) {
      this.score += 1;
      this.scoreText.setText(`Score: ${this.score}`);
      this.correctFound++;
      this.updateHelperText();
      this.showBadgeResult(badge, true);

      if (this.devMode) {
        // Dev mode: pre-fetch next box but DON'T auto-advance
        this.transitioning = true; // block further taps
        if (this.useApi) {
          fetchNextBox().then((box) => { this.pendingNextBox = box; });
        }
        return;
      }

      // Normal mode: advance to next round
      this.transitioning = true;
      this.timerEvent.destroy();

      if (this.useApi) {
        const fetchPromise = fetchNextBox();
        const delayPromise = new Promise<void>((resolve) => this.time.delayedCall(1200, resolve));
        Promise.all([fetchPromise, delayPromise]).then(([box]) => {
          this.pendingNextBox = box;
          this.advanceToNextBox();
        });
      } else {
        this.time.delayedCall(1200, () => this.advanceToNextBox());
      }
    } else {
      this.score -= 1;
      this.scoreText.setText(`Score: ${this.score}`);
      this.helperText.setText("nope!").setColor("#ff4444");
      this.showBadgeResult(badge, false);

      if (this.devMode) {
        // Dev mode: show wrong feedback but DON'T end the game
        // Show correct answers semi-transparent
        for (const b of this.badges) {
          if (b.data.isCorrect && !b.selected) this.showBadgeMissed(b);
        }
        // Don't set transitioning — let developer keep exploring or click Next Round
        return;
      }

      // Normal mode: game over
      this.transitioning = true;
      this.timerEvent.destroy();
      for (const b of this.badges) {
        if (b.data.isCorrect && !b.selected) this.showBadgeMissed(b);
      }
      this.showWrongPickLightbox(badge);
    }
  }

  // ── Visual feedback ────────────────────────────────────

  private showAllResults(correctIds: number[]) {
    for (const b of this.badges) {
      if (correctIds.includes(b.data.id) && !b.selected) {
        this.showBadgeMissed(b);
      }
    }
  }

  private showBadgeResult(badge: BadgeObject, correct: boolean) {
    const holeRadius = this.getHoleRadius();
    if (correct) {
      const ring = this.add.graphics();
      ring.lineStyle(4, 0x2e7d32, 1);
      ring.strokeCircle(0, 0, holeRadius * 0.85);
      badge.container.add(ring);
      this.tweens.add({
        targets: badge.container,
        scale: 1.1,
        duration: 200,
        yoyo: true,
        ease: "Quad.easeOut",
      });
    } else {
      const overlay = this.add.graphics();
      overlay.fillStyle(0xff0000, 0.3);
      overlay.fillCircle(0, 0, holeRadius * 0.85);
      badge.container.add(overlay);
      const origX = badge.container.x;
      this.tweens.add({
        targets: badge.container,
        x: origX - 5,
        duration: 40,
        yoyo: true,
        repeat: 4,
        onComplete: () => { badge.container.x = origX; },
      });
    }
  }

  private showBadgeMissed(badge: BadgeObject) {
    const holeRadius = this.getHoleRadius();
    const ring = this.add.graphics();
    ring.lineStyle(3, 0x2e7d32, 0.6);
    ring.strokeCircle(0, 0, holeRadius * 0.85);
    badge.container.add(ring);
    badge.container.setAlpha(0.6);
  }

  private showWrongPickLightbox(badge: BadgeObject) {
    const { width, height } = this.scale;

    // Dark overlay
    const overlay = this.add.graphics().setDepth(300);
    overlay.fillStyle(0x000000, 0.75);
    overlay.fillRect(0, 0, width, height);

    const lightbox = this.add.container(width / 2, height / 2).setDepth(301);

    // Cream panel background
    const panelW = Math.min(width * 0.85, 600);
    const panelH = Math.min(height * 0.8, 750);
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0xfff8e1, 1);
    panelBg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
    panelBg.lineStyle(3, 0xe0d5b7, 1);
    panelBg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 24);
    lightbox.add(panelBg);

    // Large circular photo — 3x bigger than before
    const textureKey = `ball_img_${badge.data.id}`;
    const imgRadius = Math.min(panelW * 0.35, panelH * 0.28);
    const photoY = -panelH * 0.12;

    // Circle frame (white border)
    const frame = this.add.graphics();
    frame.fillStyle(0xffffff, 1);
    frame.fillCircle(0, photoY, imgRadius + 8);
    frame.lineStyle(3, 0xdddddd, 0.8);
    frame.strokeCircle(0, photoY, imgRadius + 8);
    lightbox.add(frame);

    if (this.textures.exists(textureKey)) {
      const photo = this.add.image(0, photoY, textureKey);
      photo.setDisplaySize(imgRadius * 2, imgRadius * 2);

      // Circle mask
      const mask = this.add.graphics();
      mask.fillStyle(0xffffff);
      mask.fillCircle(width / 2, height / 2 + photoY, imgRadius);
      photo.setMask(mask.createGeometryMask());

      lightbox.add(photo);
    }

    // Error caption — use wrongTemplate from the question if available
    const template = this.currentBox.wrongTemplate;
    const errorMsg = template
      ? template.replace("{name}", badge.data.label)
      : `${badge.data.label} doesn't belong!`;

    const captionY = photoY + imgRadius + 30;
    const caption = this.add
      .text(0, captionY, errorMsg, {
        fontFamily: "Ranchers, cursive",
        fontSize: `${Math.min(32, Math.max(20, width * 0.045))}px`,
        color: "#c62828",
        align: "center",
        wordWrap: { width: panelW * 0.8 },
      })
      .setOrigin(0.5, 0);
    lightbox.add(caption);

    // Buttons
    const btnY = captionY + caption.height + 30;
    const btnW = Math.min(200, panelW * 0.38);
    const btnH = 55;
    const btnGap = 16;

    // PLAY AGAIN button
    const playBg = this.add.graphics();
    playBg.fillStyle(0x2e7d32, 1);
    playBg.fillRoundedRect(-btnW - btnGap / 2, btnY, btnW, btnH, 14);
    const playText = this.add
      .text(-btnW / 2 - btnGap / 2, btnY + btnH / 2, "PLAY AGAIN", {
        fontFamily: "Ranchers, cursive", fontSize: "22px", color: "#ffffff",
      }).setOrigin(0.5);
    const playZone = this.add.zone(-btnW / 2 - btnGap / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    playZone.on("pointerdown", () => { overlay.destroy(); lightbox.destroy(); this.scene.restart(); });
    lightbox.add([playBg, playText, playZone]);

    // HOME button
    const homeBg = this.add.graphics();
    homeBg.fillStyle(0x78909c, 1);
    homeBg.fillRoundedRect(btnGap / 2, btnY, btnW, btnH, 14);
    const homeText = this.add
      .text(btnW / 2 + btnGap / 2, btnY + btnH / 2, "HOME", {
        fontFamily: "Ranchers, cursive", fontSize: "22px", color: "#ffffff",
      }).setOrigin(0.5);
    const homeZone = this.add.zone(btnW / 2 + btnGap / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    homeZone.on("pointerdown", () => { overlay.destroy(); lightbox.destroy(); this.scene.start("MenuScene"); });
    lightbox.add([homeBg, homeText, homeZone]);

    // Animate in
    lightbox.setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: lightbox, alpha: 1, scale: 1, duration: 300, ease: "Back.easeOut" });
  }

  // ── Dev mode UI ────────────────────────────────────────

  private createDevButtons() {
    const { width, height } = this.scale;
    const gridBottom = this.gridY + (1050 * this.gridScale);
    const btnW = 140;
    const btnH = 44;
    const btnY = gridBottom + 70;
    const gap = 40;

    // Feedback button
    this.devFeedbackBtn = this.add.container(width / 2 - btnW - gap / 2, btnY).setDepth(100);
    const fbBg = this.add.graphics();
    fbBg.fillStyle(0x1565c0, 1);
    fbBg.fillRoundedRect(0, 0, btnW, btnH, 10);
    const fbText = this.add
      .text(btnW / 2, btnH / 2, "FEEDBACK", {
        fontFamily: "Ranchers, cursive", fontSize: "18px", color: "#ffffff",
      })
      .setOrigin(0.5);
    const fbZone = this.add.zone(btnW / 2, btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    fbZone.on("pointerdown", () => this.showDevFeedbackDialog());
    this.devFeedbackBtn.add([fbBg, fbText, fbZone]);

    // Next Round button
    this.devNextBtn = this.add.container(width / 2 + gap / 2, btnY).setDepth(100);
    const nrBg = this.add.graphics();
    nrBg.fillStyle(0x2e7d32, 1);
    nrBg.fillRoundedRect(0, 0, btnW, btnH, 10);
    const nrText = this.add
      .text(btnW / 2, btnH / 2, "NEXT ROUND", {
        fontFamily: "Ranchers, cursive", fontSize: "18px", color: "#ffffff",
      })
      .setOrigin(0.5);
    const nrZone = this.add.zone(btnW / 2, btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    nrZone.on("pointerdown", () => this.devAdvanceRound());
    this.devNextBtn.add([nrBg, nrText, nrZone]);
  }

  private devAdvanceRound() {
    if (this.devMode) {
      // If we already have a pending box from a correct pick, use it
      if (this.pendingNextBox) {
        this.advanceToNextBox();
        return;
      }
      // Otherwise fetch one now
      this.transitioning = true;
      if (this.useApi) {
        fetchNextBox().then((box) => {
          this.pendingNextBox = box;
          this.advanceToNextBox();
        });
      } else {
        this.advanceToNextBox();
      }
    }
  }

  private showDevFeedbackDialog() {
    const { width, height } = this.scale;

    // Dark overlay
    const overlay = this.add.graphics().setDepth(400);
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains
    ); // block clicks through

    const panelW = Math.min(width * 0.9, 500);
    const panelH = 340;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    const panel = this.add.container(0, 0).setDepth(401);

    // Panel background
    const bg = this.add.graphics();
    bg.fillStyle(0xffffff, 1);
    bg.fillRoundedRect(panelX, panelY, panelW, panelH, 16);
    bg.lineStyle(2, 0xcccccc, 1);
    bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 16);
    panel.add(bg);

    // Title
    const title = this.add
      .text(width / 2, panelY + 24, "Round Feedback", {
        fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#333333",
      })
      .setOrigin(0.5, 0);
    panel.add(title);

    // Round info
    const info = `"${this.currentBox?.categoryName || "?"}" — Round ${this.currentBoxIndex + 1}`;
    const infoText = this.add
      .text(width / 2, panelY + 60, info, {
        fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#666666",
      })
      .setOrigin(0.5, 0);
    panel.add(infoText);

    // Create HTML textarea overlay for text input
    const textareaId = "dev-feedback-input";
    let textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (textarea) textarea.remove();

    textarea = document.createElement("textarea");
    textarea.id = textareaId;
    textarea.placeholder = "Enter your feedback about this round...";
    textarea.style.cssText = `
      position: fixed;
      left: ${panelX + 20}px;
      top: ${panelY + 90}px;
      width: ${panelW - 40}px;
      height: 120px;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      padding: 10px;
      border: 2px solid #ccc;
      border-radius: 8px;
      resize: none;
      z-index: 10000;
      outline: none;
    `;
    document.body.appendChild(textarea);
    textarea.focus();

    // Buttons
    const btnW = 110;
    const btnH = 44;
    const btnY2 = panelY + panelH - btnH - 20;

    // Save button
    const saveBg = this.add.graphics();
    saveBg.fillStyle(0x2e7d32, 1);
    saveBg.fillRoundedRect(width / 2 - btnW - 8, btnY2, btnW, btnH, 10);
    const saveText = this.add
      .text(width / 2 - btnW / 2 - 8, btnY2 + btnH / 2, "SAVE", {
        fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ffffff", fontStyle: "bold",
      })
      .setOrigin(0.5);
    const saveZone = this.add.zone(width / 2 - btnW / 2 - 8, btnY2 + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    saveZone.on("pointerdown", () => {
      const feedbackText = textarea?.value?.trim() || "";
      if (!feedbackText) return;

      // Build options payload
      const options = this.badges.map((b) => ({
        id: b.data.id,
        label: b.data.label,
        isCorrect: b.data.isCorrect,
      }));

      submitDevFeedback({
        questionText: this.currentBox?.categoryName || "",
        options,
        selectedOptionId: this.lastSelectedBadge?.data.id,
        selectedOptionLabel: this.lastSelectedBadge?.data.label,
        feedback: feedbackText,
      });

      cleanup();
    });
    panel.add([saveBg, saveText, saveZone]);

    // Cancel button
    const cancelBg = this.add.graphics();
    cancelBg.fillStyle(0x78909c, 1);
    cancelBg.fillRoundedRect(width / 2 + 8, btnY2, btnW, btnH, 10);
    const cancelText = this.add
      .text(width / 2 + btnW / 2 + 8, btnY2 + btnH / 2, "CANCEL", {
        fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ffffff", fontStyle: "bold",
      })
      .setOrigin(0.5);
    const cancelZone = this.add.zone(width / 2 + btnW / 2 + 8, btnY2 + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    cancelZone.on("pointerdown", () => cleanup());
    panel.add([cancelBg, cancelText, cancelZone]);

    const cleanup = () => {
      textarea?.remove();
      overlay.destroy();
      panel.destroy();
    };
  }

  // ── Navigation ─────────────────────────────────────────

  private advanceToNextBox() {
    this.currentBoxIndex++;
    const nextBox = this.useApi ? this.pendingNextBox : TEST_BOXES[this.currentBoxIndex];
    this.pendingNextBox = null;

    if (!nextBox) {
      this.endGame();
      return;
    }

    // Badges fly up and out
    for (const b of this.badges) {
      const flyY = this.gridY - (1050 * this.gridScale) - this.getHoleRadius() * 3;
      this.tweens.add({
        targets: b.container,
        y: flyY - Math.random() * 80,
        alpha: 0,
        duration: 300,
        ease: "Quad.easeIn",
      });
    }

    this.time.delayedCall(350, () => this.loadBox(nextBox));
  }

  // ── Timer ──────────────────────────────────────────────

  private tickTimer() {
    if (this.gameOver || this.transitioning || this.paused) return;
    this.timeRemaining -= 100;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.onTimeUp();
    }
    this.drawTimer();
  }

  private onTimeUp() {
    this.timerEvent.destroy();
    this.transitioning = true;
    this.helperText.setText("time's up!").setColor("#ff4444");
    this.time.delayedCall(2000, () => this.endGame());
  }

  private endGame() {
    this.gameOver = true;
    if (this.timerEvent) this.timerEvent.destroy();
    this.scene.start("ResultScene", {
      score: this.score,
      boxesCleared: this.currentBoxIndex,
    });
  }

  private drawTimer() {
    const g = this.timerBar;
    g.clear();

    const fraction = this.timeRemaining / this.currentBox.timeLimitMs;

    // Slightly narrower than the grid, centered below it
    const gridSize = 2100 * this.gridScale;
    const barWidth = 1900 * this.gridScale;
    const barHeight = 50;
    const barX = this.gridX - barWidth / 2;
    const gridBottom = this.gridY + gridSize / 2;
    const barY = gridBottom + 10;
    const radius = 10;

    // Background
    g.fillStyle(0x000000, 0.2);
    g.fillRoundedRect(barX, barY, barWidth, barHeight, radius);

    // Fill
    const fillColor =
      fraction > 0.5 ? COLORS.timerGreen : fraction > 0.25 ? COLORS.timerYellow : COLORS.timerRed;
    g.fillStyle(fillColor, 1);
    if (barWidth * fraction > 1) {
      g.fillRoundedRect(barX, barY, barWidth * fraction, barHeight, radius);
    }

    g.lineStyle(2, 0x000000, 0.25);
    g.strokeRoundedRect(barX, barY, barWidth, barHeight, radius);

    const seconds = (this.timeRemaining / 1000).toFixed(1);
    this.timerText.setText(`${seconds}s`).setPosition(this.gridX, barY + barHeight + 14);
  }
}
