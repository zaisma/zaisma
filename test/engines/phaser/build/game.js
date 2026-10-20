// A Phaser sample for Zaisma's engine tests: a ship that flies with the arrow keys or a touch, over a
// starfield, with arcade physics, textures drawn at start and the game's own browser save (best time).
class Flight extends Phaser.Scene {
  create() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xe8eef8).fillTriangle(16, 0, 32, 40, 0, 40).generateTexture("ship", 32, 40).clear();
    g.fillStyle(0xffffff).fillCircle(2, 2, 2).generateTexture("star", 4, 4).clear();
    g.fillStyle(0xd06040).fillCircle(14, 14, 14).generateTexture("rock", 28, 28).destroy();

    this.stars = this.add.group({ key: "star", repeat: 120 });
    this.stars.getChildren().forEach((star) => star.setPosition(Phaser.Math.Between(0, 960), Phaser.Math.Between(0, 540)).setAlpha(Math.random()));

    this.ship = this.physics.add.image(480, 440, "ship").setCollideWorldBounds(true).setDrag(600);
    this.rocks = this.physics.add.group();
    this.physics.add.overlap(this.ship, this.rocks, () => this.restart());
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.rocks.create(Phaser.Math.Between(20, 940), -20, "rock").setVelocityY(Phaser.Math.Between(120, 260)) });

    this.best = Number(localStorage.getItem("best_seconds") || 0);
    this.startedAt = this.time.now;
    this.label = this.add.text(16, 16, "", { fontFamily: "sans-serif", fontSize: "20px", color: "#e8eef8" });
    this.keys = this.input.keyboard.createCursorKeys();
    window.zaismaEngineSample = { engine: "phaser", version: Phaser.VERSION, started: true };
  }

  restart() {
    this.best = Math.max(this.best, (this.time.now - this.startedAt) / 1000);
    localStorage.setItem("best_seconds", String(this.best));
    this.rocks.clear(true, true);
    this.startedAt = this.time.now;
  }

  update(_time, delta) {
    const pointer = this.input.activePointer;
    const steer = this.keys.left.isDown ? -1 : this.keys.right.isDown ? 1 : pointer.isDown ? Math.sign(pointer.x - this.ship.x) : 0;
    if (steer) this.ship.setVelocityX(steer * 420);
    this.stars.getChildren().forEach((star) => { star.y = (star.y + delta * 0.05 * (1 + star.alpha)) % 540; });
    this.label.setText(`Time ${((this.time.now - this.startedAt) / 1000).toFixed(1)}s   Best ${this.best.toFixed(1)}s`);
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: 960, height: 540, backgroundColor: "#10141c", physics: { default: "arcade" }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: Flight });
