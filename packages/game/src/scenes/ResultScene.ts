import Phaser from "phaser";
import { COLORS } from "../utils/colors.js";

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: "ResultScene" });
  }

  create(data: { score: number; boxesCleared: number }) {
    const { width, height } = this.scale;
    const score = data.score ?? 0;
    const boxesCleared = data.boxesCleared ?? 0;

    // Background overlay
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.4);

    // Result card
    const cardW = Math.min(width * 0.8, 400);
    const cardH = 300;
    const cardX = width / 2 - cardW / 2;
    const cardY = height / 2 - cardH / 2;

    const card = this.add.graphics();
    card.fillStyle(COLORS.cardboard, 1);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 16);
    card.lineStyle(3, COLORS.woodBrownDark, 1);
    card.strokeRoundedRect(cardX, cardY, cardW, cardH, 16);

    // Game Over title
    this.add
      .text(width / 2, cardY + 50, "GAME OVER", {
        fontFamily: "Ranchers, cursive",
        fontSize: "36px",
        color: COLORS.textDark,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Score
    this.add
      .text(width / 2, cardY + 110, `Score: ${score}`, {
        fontFamily: "Ranchers, cursive",
        fontSize: "28px",
        color: COLORS.textDark,
      })
      .setOrigin(0.5);

    // Boxes cleared
    this.add
      .text(width / 2, cardY + 155, `Boxes Cleared: ${boxesCleared}`, {
        fontFamily: "Ranchers, cursive",
        fontSize: "20px",
        color: "#795548",
      })
      .setOrigin(0.5);

    // Play Again button
    const btnWidth = 200;
    const btnHeight = 50;
    const btnX = width / 2 - btnWidth / 2;
    const btnY = cardY + 200;

    const btn = this.add.graphics();
    btn.fillStyle(COLORS.woodBrown, 1);
    btn.fillRoundedRect(btnX, btnY, btnWidth, btnHeight, 10);
    btn.lineStyle(2, COLORS.woodBrownDark, 1);
    btn.strokeRoundedRect(btnX, btnY, btnWidth, btnHeight, 10);

    this.add
      .text(width / 2, btnY + btnHeight / 2, "PLAY AGAIN", {
        fontFamily: "Ranchers, cursive",
        fontSize: "22px",
        color: COLORS.textLight,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .rectangle(width / 2, btnY + btnHeight / 2, btnWidth, btnHeight)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        this.scene.start("GameScene");
      });

    // Handle resize
    this.scale.on("resize", () => {
      this.scene.restart(data);
    });
  }
}
