import Phaser from 'phaser';
import EnemyManager from '../systems/EnemyManager.js';
import ProgressionSystem from '../systems/ProgressionSystem.js';
import SwordOrbitSystem from '../systems/SwordOrbitSystem.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    const { width, height } = this.scale;

    this.background = this.add.tileSprite(0, 0, width, height, 'bg').setOrigin(0, 0);

    this.player = this.physics.add.sprite(width / 2, height / 2, 'player');
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(1);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.swordOrbit = new SwordOrbitSystem(this);
    this.enemyManager = new EnemyManager(this);
    this.progression = new ProgressionSystem(this, this.swordOrbit);
    this.progression.attachPlayer(this.player);
    this.swordOrbit.addSword(this);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');

    this.scale.on('resize', this.handleResize, this);
  }

  handleResize(gameSize) {
    const { width, height } = gameSize;

    if (this.background) {
      this.background.setSize(width, height);
    }
  }

  update(time, delta) {
    const speed = 150;
    const velocityX = this.getHorizontalInput() * speed;
    const velocityY = this.getVerticalInput() * speed;

    this.player.setVelocity(velocityX, velocityY);

    this.enemyManager.update(this.player, delta);
    this.swordOrbit.update(this.player, delta, this.enemyManager.enemies);
    this.progression.update(this.player, delta);

    this.background.tilePositionX = this.cameras.main.scrollX * 0.25;
    this.background.tilePositionY = this.cameras.main.scrollY * 0.25;
  }

  getHorizontalInput() {
    let direction = 0;

    if (this.cursors.left.isDown || this.keys.A.isDown) {
      direction -= 1;
    }

    if (this.cursors.right.isDown || this.keys.D.isDown) {
      direction += 1;
    }

    return direction;
  }

  getVerticalInput() {
    let direction = 0;

    if (this.cursors.up.isDown || this.keys.W.isDown) {
      direction -= 1;
    }

    if (this.cursors.down.isDown || this.keys.S.isDown) {
      direction += 1;
    }

    return direction;
  }
}
