import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
// @ts-ignore – no types bundled
import GifEncoder from 'gif-encoder-2';

const FONTS_DIR = path.join(import.meta.dirname, '..', 'media', 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Ubuntu-Bold.ttf'), 'WheelFont');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Ubuntu-Regular.ttf'), 'WheelFont');

const PALETTE = [
  '#E74C3C',
  '#3498DB',
  '#2ECC71',
  '#F39C12',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#2980B9',
  '#C0392B',
  '#27AE60',
  '#8E44AD',
  '#16A085',
];

const SIZE = 400;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = SIZE / 2 - 22;
const SPIN_FRAMES = 60;
const FRAME_DELAY_MS = 50;
const WINNER_DELAY_MS = 3000;

function drawFrame(ctx: any, names: string[], angle: number, winner?: string): void {
  ctx.fillStyle = '#23272A';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const slice = (Math.PI * 2) / names.length;
  const fontSize = names.length > 12 ? 10 : names.length > 8 ? 12 : 14;

  names.forEach((name, i) => {
    const start = angle + i * slice;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, RADIUS, start, end);
    ctx.closePath();
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(start + slice / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px WheelFont`;
    const maxChars = names.length > 10 ? 10 : 14;
    const label = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
    ctx.fillText(label, RADIUS - 8, fontSize / 2);
    ctx.restore();
  });

  // Outer ring
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(CX, CY, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Pointer at top
  ctx.beginPath();
  ctx.moveTo(CX - 11, 2);
  ctx.lineTo(CX + 11, 2);
  ctx.lineTo(CX, 28);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#23272A';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (winner) {
    const boxH = 56;
    const boxY = SIZE - boxH - 8;

    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    roundRect(ctx, 10, boxY, SIZE - 20, boxH, 8);
    ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 14px WheelFont';
    ctx.textAlign = 'center';
    ctx.fillText('Winner', CX, boxY + 20);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 19px WheelFont';
    const winLabel = winner.length > 28 ? winner.slice(0, 27) + '…' : winner;
    ctx.fillText(winLabel, CX, boxY + 44);
  }
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function getWinner(names: string[], finalAngle: number): string {
  const slice = (Math.PI * 2) / names.length;
  // Pointer is at the top (−π/2)
  const normalized = (((-Math.PI / 2 - finalAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return names[Math.floor(normalized / slice) % names.length]!;
}

export async function generateWheelSpinGif(names: string[]): Promise<Buffer> {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  const encoder = new GifEncoder(SIZE, SIZE);
  encoder.setRepeat(0);
  encoder.setQuality(3);
  encoder.start();

  const startAngle = Math.random() * Math.PI * 2;
  const totalRotation = Math.PI * 2 * (7 + Math.random() * 4);
  const finalAngle = startAngle + totalRotation;

  encoder.setDelay(FRAME_DELAY_MS);
  for (let i = 0; i <= SPIN_FRAMES; i++) {
    const t = i / SPIN_FRAMES;
    const eased = 1 - Math.pow(1 - t, 4);
    const angle = startAngle + totalRotation * eased;

    drawFrame(ctx, names, angle);
    encoder.addFrame(ctx.getImageData(0, 0, SIZE, SIZE).data);
  }

  const winner = getWinner(names, finalAngle);

  encoder.setDelay(WINNER_DELAY_MS);
  drawFrame(ctx, names, finalAngle, winner);
  encoder.addFrame(ctx.getImageData(0, 0, SIZE, SIZE).data);

  encoder.finish();

  return encoder.out.getData() as Buffer;
}
