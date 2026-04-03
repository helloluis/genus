import Phaser from "phaser";
import { COLORS } from "../utils/colors.js";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create() {
    const { width, height } = this.scale;

    // Title
    this.add
      .text(width / 2, height * 0.3, "GENUS", {
        fontFamily: "Georgia, serif",
        fontSize: `${Math.min(width * 0.15, 96)}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Subtitle
    this.add
      .text(width / 2, height * 0.42, "A General Knowledge Game", {
        fontFamily: "Georgia, serif",
        fontSize: `${Math.min(width * 0.04, 24)}px`,
        color: "#795548",
      })
      .setOrigin(0.5);

    // Play button
    const btnWidth = Math.min(width * 0.5, 240);
    const btnHeight = 60;
    const btnX = width / 2 - btnWidth / 2;
    const btnY = height * 0.58;

    const btn = this.add.graphics();
    btn.fillStyle(COLORS.woodBrown, 1);
    btn.fillRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);
    btn.lineStyle(3, COLORS.woodBrownDark, 1);
    btn.strokeRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);

    const btnText = this.add
      .text(width / 2, btnY + btnHeight / 2, "PLAY", {
        fontFamily: "Georgia, serif",
        fontSize: "28px",
        color: COLORS.textLight,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Make button interactive
    const hitArea = this.add
      .rectangle(width / 2, btnY + btnHeight / 2, btnWidth, btnHeight)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        btn.clear();
        btn.fillStyle(COLORS.woodBrownLight, 1);
        btn.fillRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);
        btn.lineStyle(3, COLORS.woodBrownDark, 1);
        btn.strokeRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);
      })
      .on("pointerout", () => {
        btn.clear();
        btn.fillStyle(COLORS.woodBrown, 1);
        btn.fillRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);
        btn.lineStyle(3, COLORS.woodBrownDark, 1);
        btn.strokeRoundedRect(btnX, btnY, btnWidth, btnHeight, 12);
      })
      .on("pointerdown", () => {
        this.scene.start("GameScene");
      });

    // Handle resize
    this.scale.on("resize", () => {
      this.scene.restart();
    });
  }
}
