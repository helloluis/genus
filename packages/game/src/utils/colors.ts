/** Ball capsule colors — translucent plastic look */
export const BALL_COLORS = [
  0xe74c3c, // red
  0x3498db, // blue
  0x2ecc71, // green
  0xf39c12, // orange
  0x9b59b6, // purple
  0x1abc9c, // teal
  0xe91e63, // pink
  0x00bcd4, // cyan
  0xff9800, // amber
  0x8bc34a, // light green
];

/** Get a random ball color */
export function randomBallColor(): number {
  return BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
}

/** UI colors */
export const COLORS = {
  woodBrown: 0x8b6914,
  woodBrownDark: 0x5c4510,
  woodBrownLight: 0xc49a3c,
  cardboard: 0xf5e6c8,
  noteYellow: 0xfff9c4,
  noteBorder: 0xc8b678,
  timerGreen: 0x4caf50,
  timerYellow: 0xffc107,
  timerRed: 0xf44336,
  selectedRing: 0xffd700,
  correctGlow: 0x4caf50,
  wrongFlash: 0xf44336,
  helperGlow: 0xffffff,
  conveyorGray: 0x607d8b,
  conveyorStripe: 0x455a64,
  background: 0xf0ebe3,
  textDark: "#3e2723",
  textLight: "#fff8e1",
};
