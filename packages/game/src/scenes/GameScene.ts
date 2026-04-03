import Phaser from "phaser";
import { COLORS } from "../utils/colors.js";
import { TEST_BOXES } from "../utils/testdata.js";
import type { BallData, BoxData } from "../utils/types.js";
import { startGame, syncPicks, isOfflineMode } from "../api.js";

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

  // Grid positioning (computed on layout)
  private gridX = 0;
  private gridY = 0;
  private gridScale = 1;

  constructor() {
    super({ key: "GameScene" });
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
        fontFamily: "Georgia, serif",
        fontSize: `${Math.min(34, Math.max(18, width * 0.04))}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(100);

    // Score — top right
    this.scoreText = this.add
      .text(width - 16, 16, "Score: 0", {
        fontFamily: "Georgia, serif",
        fontSize: `${Math.min(20, Math.max(14, width * 0.025))}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
      })
      .setOrigin(1, 0)
      .setDepth(100);

    // Pause button — below score
    const pauseBtn = this.add
      .text(width - 16, 40, "⏸", {
        fontFamily: "Arial, sans-serif",
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
        fontFamily: "Georgia, serif",
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
        fontFamily: "Georgia, serif",
        fontSize: "15px",
        color: COLORS.textDark,
      })
      .setOrigin(0.5)
      .setDepth(100);

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

    // Update UI
    this.categoryText.setText(box.categoryName);

    // Count correct for helper text
    const badgesToShow = box.balls.slice(0, NUM_BADGES);
    this.correctTotal = badgesToShow.filter((b) => b.isCorrect).length;
    if (this.useApi) {
      this.helperText.setText("");
    } else {
      this.updateHelperText();
    }

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
      this.createBadges(badgesToShow);
      if (this.timerEvent) this.timerEvent.destroy();
      this.timerEvent = this.time.addEvent({
        delay: 100,
        callback: this.tickTimer,
        callbackScope: this,
        loop: true,
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
      this.helperText.setText("all found!");
    } else if (remaining === 1) {
      this.helperText.setText("last one!");
    } else if (this.correctFound === 0) {
      this.helperText.setText(`find ${this.correctTotal}!`);
    } else {
      this.helperText.setText(`${remaining} to go!`);
    }
    this.helperText.setColor(COLORS.textDark);
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

      // Label on top of the grid (higher depth so it's visible above the grid sprite)
      let label: Phaser.GameObjects.Text | null = null;
      if (!this.currentBox.hideLabels || !photo) {
        const maxChars = 12;
        const displayLabel =
          badgesData[i].label.length > maxChars
            ? badgesData[i].label.substring(0, maxChars - 1) + "…"
            : badgesData[i].label;

        const fontSize = Math.max(10, badgeRadius * 0.26);
        label = this.add
          .text(cx, cy + holeRadius + fontSize * 0.4, displayLabel, {
            fontFamily: "Georgia, serif",
            fontSize: `${fontSize}px`,
            color: "#ffffff",
            align: "center",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
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

      const allFound = this.badges
        .filter((b) => b.data.isCorrect)
        .every((b) => b.selected);
      if (allFound) {
        this.transitioning = true;
        this.timerEvent.destroy();
        this.time.delayedCall(1200, () => this.advanceToNextBox());
      }
    } else {
      this.score -= 1;
      this.scoreText.setText(`Score: ${this.score}`);
      this.helperText.setText("nope!").setColor("#ff4444");
      this.showBadgeResult(badge, false);
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

    const overlay = this.add.graphics().setDepth(300);
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(0, 0, width, height);

    const lightbox = this.add.container(width / 2, height / 2).setDepth(301);

    const textureKey = `ball_img_${badge.data.id}`;
    const imgSize = Math.min(width * 0.55, 350);
    if (this.textures.exists(textureKey)) {
      const photo = this.add.image(0, -60, textureKey);
      photo.setDisplaySize(imgSize, imgSize);
      const frame = this.add.graphics();
      const pad = 12;
      frame.fillStyle(0xffffff, 1);
      frame.fillRoundedRect(-imgSize / 2 - pad, -60 - imgSize / 2 - pad, imgSize + pad * 2, imgSize + pad * 2, 12);
      lightbox.add([frame, photo]);
    }

    const caption = this.add
      .text(0, imgSize / 2 - 30, `${badge.data.label}\ndoesn't belong in "${this.currentBox.categoryName}"!`, {
        fontFamily: "Georgia, serif",
        fontSize: `${Math.min(26, Math.max(18, width * 0.04))}px`,
        color: "#ff6b6b",
        fontStyle: "bold",
        align: "center",
      })
      .setOrigin(0.5, 0);
    lightbox.add(caption);

    const btnY = caption.y + caption.height + 40;
    const btnW = 180;
    const btnH = 50;
    const btnGap = 20;

    const playBg = this.add.graphics();
    playBg.fillStyle(0x2e7d32, 1);
    playBg.fillRoundedRect(-btnW - btnGap / 2, btnY, btnW, btnH, 12);
    const playText = this.add
      .text(-btnW / 2 - btnGap / 2, btnY + btnH / 2, "PLAY AGAIN", {
        fontFamily: "Georgia, serif", fontSize: "18px", color: "#ffffff", fontStyle: "bold",
      }).setOrigin(0.5);
    const playZone = this.add.zone(-btnW / 2 - btnGap / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    playZone.on("pointerdown", () => { overlay.destroy(); lightbox.destroy(); this.scene.restart(); });
    lightbox.add([playBg, playText, playZone]);

    const homeBg = this.add.graphics();
    homeBg.fillStyle(0x555555, 1);
    homeBg.fillRoundedRect(btnGap / 2, btnY, btnW, btnH, 12);
    const homeText = this.add
      .text(btnW / 2 + btnGap / 2, btnY + btnH / 2, "HOME", {
        fontFamily: "Georgia, serif", fontSize: "18px", color: "#ffffff", fontStyle: "bold",
      }).setOrigin(0.5);
    const homeZone = this.add.zone(btnW / 2 + btnGap / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true });
    homeZone.on("pointerdown", () => { overlay.destroy(); lightbox.destroy(); this.scene.start("MenuScene"); });
    lightbox.add([homeBg, homeText, homeZone]);

    lightbox.setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: lightbox, alpha: 1, scale: 1, duration: 300, ease: "Back.easeOut" });
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

    const { width, height } = this.scale;
    const fraction = this.timeRemaining / this.currentBox.timeLimitMs;
    const barWidth = Math.min(width * 0.7, 500);
    const barHeight = 12;
    const barX = (width - barWidth) / 2;
    const barY = height - 40;

    g.fillStyle(0x000000, 0.15);
    g.fillRoundedRect(barX, barY, barWidth, barHeight, 6);

    const fillColor =
      fraction > 0.5 ? COLORS.timerGreen : fraction > 0.25 ? COLORS.timerYellow : COLORS.timerRed;
    g.fillStyle(fillColor, 1);
    if (barWidth * fraction > 1) {
      g.fillRoundedRect(barX, barY, barWidth * fraction, barHeight, 6);
    }

    g.lineStyle(1.5, 0x000000, 0.2);
    g.strokeRoundedRect(barX, barY, barWidth, barHeight, 6);

    const seconds = (this.timeRemaining / 1000).toFixed(1);
    this.timerText.setText(`${seconds}s`).setPosition(width / 2, barY + barHeight + 12);
  }
}
