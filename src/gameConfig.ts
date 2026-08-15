import Phaser from 'phaser';
import GameScene from './scenes/GameScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 1280,
  height: 720,
  backgroundColor: '#090909',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 } as Phaser.Types.Math.Vector2Like,
      debug: false,
    },
  },
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
