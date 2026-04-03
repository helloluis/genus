import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    const { width, height } = this.scale;

    // Loading bar
    const barWidth = width * 0.6;
    const barHeight = 20;
    const barX = (width - barWidth) / 2;
    const barY = height / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x3e2723, 1);
    bg.fillRect(barX, barY, barWidth, barHeight);

    const progress = this.add.graphics();
    this.load.on("progress", (value: number) => {
      progress.clear();
      progress.fillStyle(0xc49a3c, 1);
      progress.fillRect(barX, barY, barWidth * value, barHeight);
    });

    this.load.on("complete", () => {
      progress.destroy();
      bg.destroy();
    });

    // Load sprites
    this.load.image("grid", "/assets/sprites/grid.png");
  }

  create() {
    this.scene.start("MenuScene");
  }
}
