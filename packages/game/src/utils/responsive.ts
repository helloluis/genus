export interface Layout {
  isPortrait: boolean;
  width: number;
  height: number;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  ballRadius: number;
  ballCols: number;
  ballRows: number;
  ballStartX: number;
  ballStartY: number;
  ballSpacingX: number;
  ballSpacingY: number;
  labelX: number;
  labelY: number;
  timerX: number;
  timerY: number;
  timerWidth: number;
  scoreX: number;
  scoreY: number;
}

export function calculateLayout(width: number, height: number): Layout {
  const isPortrait = height > width;

  if (isPortrait) {
    // Mobile portrait layout
    const boxWidth = width * 0.9;
    const boxHeight = height * 0.6;
    const boxX = width * 0.05;
    const boxY = height * 0.2;

    const ballCols = 5;
    const ballRows = 5;
    const ballArea = Math.min(boxWidth, boxHeight * 0.85);
    const ballSpacingX = ballArea / ballCols;
    const ballSpacingY = (boxHeight * 0.8) / ballRows;
    const ballRadius = Math.min(ballSpacingX, ballSpacingY) * 0.38;
    const ballStartX = boxX + (boxWidth - ballArea) / 2 + ballSpacingX / 2;
    const ballStartY = boxY + boxHeight * 0.18 + ballSpacingY / 2;

    return {
      isPortrait,
      width,
      height,
      boxX,
      boxY,
      boxWidth,
      boxHeight,
      ballRadius,
      ballCols,
      ballRows,
      ballStartX,
      ballStartY,
      ballSpacingX,
      ballSpacingY,
      labelX: width / 2,
      labelY: boxY + boxHeight * 0.08,
      timerX: width * 0.05,
      timerY: height * 0.85,
      timerWidth: width * 0.9,
      scoreX: width / 2,
      scoreY: height * 0.12,
    };
  } else {
    // Landscape / desktop layout
    const boxWidth = width * 0.55;
    const boxHeight = height * 0.8;
    const boxX = width * 0.4;
    const boxY = height * 0.1;

    const ballCols = 5;
    const ballRows = 5;
    const ballArea = Math.min(boxWidth, boxHeight * 0.85);
    const ballSpacingX = ballArea / ballCols;
    const ballSpacingY = (boxHeight * 0.8) / ballRows;
    const ballRadius = Math.min(ballSpacingX, ballSpacingY) * 0.38;
    const ballStartX = boxX + (boxWidth - ballArea) / 2 + ballSpacingX / 2;
    const ballStartY = boxY + boxHeight * 0.18 + ballSpacingY / 2;

    return {
      isPortrait,
      width,
      height,
      boxX,
      boxY,
      boxWidth,
      boxHeight,
      ballRadius,
      ballCols,
      ballRows,
      ballStartX,
      ballStartY,
      ballSpacingX,
      ballSpacingY,
      labelX: boxX + boxWidth / 2,
      labelY: boxY + boxHeight * 0.08,
      timerX: width * 0.02,
      timerY: height * 0.85,
      timerWidth: width * 0.35,
      scoreX: width * 0.2,
      scoreY: height * 0.15,
    };
  }
}
