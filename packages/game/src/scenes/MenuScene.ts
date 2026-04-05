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
        fontFamily: "Ranchers, cursive",
        fontSize: `${Math.min(width * 0.15, 96)}px`,
        color: COLORS.textDark,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Subtitle
    this.add
      .text(width / 2, height * 0.42, "A General Knowledge Game", {
        fontFamily: "Ranchers, cursive",
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
        fontFamily: "Ranchers, cursive",
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
        this.scene.start("GameScene", { devMode: false });
      });

    // Developer Mode button — smaller, below Play
    const devBtnWidth = Math.min(width * 0.4, 200);
    const devBtnHeight = 44;
    const devBtnX = width / 2 - devBtnWidth / 2;
    const devBtnY = btnY + btnHeight + 20;

    const devBtn = this.add.graphics();
    devBtn.fillStyle(0x546e7a, 1);
    devBtn.fillRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);
    devBtn.lineStyle(2, 0x37474f, 1);
    devBtn.strokeRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);

    this.add
      .text(width / 2, devBtnY + devBtnHeight / 2, "DEVELOPER MODE", {
        fontFamily: "Ranchers, cursive",
        fontSize: "18px",
        color: "#eceff1",
      })
      .setOrigin(0.5);

    this.add
      .rectangle(width / 2, devBtnY + devBtnHeight / 2, devBtnWidth, devBtnHeight)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        devBtn.clear();
        devBtn.fillStyle(0x78909c, 1);
        devBtn.fillRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);
        devBtn.lineStyle(2, 0x37474f, 1);
        devBtn.strokeRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);
      })
      .on("pointerout", () => {
        devBtn.clear();
        devBtn.fillStyle(0x546e7a, 1);
        devBtn.fillRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);
        devBtn.lineStyle(2, 0x37474f, 1);
        devBtn.strokeRoundedRect(devBtnX, devBtnY, devBtnWidth, devBtnHeight, 10);
      })
      .on("pointerdown", () => {
        this.scene.start("GameScene", { devMode: true });
      });

    // Handle resize
    this.scale.on("resize", () => {
      this.scene.restart();
    });
  }
}
