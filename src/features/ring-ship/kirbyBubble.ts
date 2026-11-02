import type { DuckAppearance } from "@/lib/avatars/duck";

// A tiny animated portrait uses one canvas texture, with no extra 3D render pass.
export function paintKirbyBubble(canvas: HTMLCanvasElement, style: DuckAppearance, time: number) {
  const context = canvas.getContext("2d")!, wobble = Math.sin(time * 12);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save(); context.scale(canvas.width / 256, canvas.height / 224);
  context.fillStyle = "#fff7fc"; context.strokeStyle = "#dc9fbe"; context.lineWidth = 4;
  context.beginPath(); context.roundRect(5, 5, 246, 191, 36); context.fill(); context.stroke();
  context.beginPath(); context.moveTo(95, 194); context.quadraticCurveTo(102, 221, 137, 215); context.lineTo(125, 194); context.fill();
  context.fillStyle = "#f7d6e6"; context.beginPath(); context.ellipse(128, 108, 83, 70, 0, 0, Math.PI * 2); context.fill();
  context.translate(126 + wobble * 5, 106); context.rotate(wobble * .14);
  const ellipse = (x: number, y: number, rx: number, ry: number, color: string, angle = 0) => {
    context.fillStyle = color; context.beginPath(); context.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); context.fill();
  };
  if (style.backpack) { context.fillStyle = style.outfitColor; context.fillRect(-43, -14, 22, 58); }
  ellipse(-18, 54, 17, 9, style.footColor || style.billColor, -.2 - wobble * .2);
  ellipse(18, 54, 17, 9, style.footColor || style.billColor, .2 + wobble * .2);
  ellipse(0, 0, 38, 57, style.featherColor);
  if (style.headColor) ellipse(0, -24, 37, 31, style.headColor);
  if (style.outfit !== "none") {
    context.fillStyle = style.outfitColor;
    context.beginPath(); context.roundRect(-38, style.outfit === "scarf" ? -11 : 4, 76, style.outfit === "scarf" ? 14 : 42, 9); context.fill();
    if (style.outfit === "firefighter") { context.fillStyle = "#e6e98a"; context.fillRect(-37, 30, 74, 6); }
  }
  ellipse(-43, 4 - wobble * 13, 12, 31, style.wingColor || style.featherColor, -.7 - wobble * .4);
  ellipse(43, 4 + wobble * 13, 12, 31, style.wingColor || style.featherColor, .7 - wobble * .4);
  context.strokeStyle = style.eyeColor; context.lineWidth = 4; context.lineCap = "round";
  for (const side of [-1, 1]) {
    const x = side * 14; context.beginPath(); context.moveTo(x - 6, -31); context.lineTo(x + 5, -24); context.lineTo(x - 6, -17); context.stroke();
  }
  ellipse(0, -7, 17, 8, style.billColor);
  const hat = style.headwearColor || style.outfitColor;
  if (style.headwear === "crown") {
    context.fillStyle = hat; context.beginPath(); context.moveTo(-32, -48); context.lineTo(-37, -75); context.lineTo(-13, -60); context.lineTo(0, -82); context.lineTo(15, -60); context.lineTo(36, -75); context.lineTo(31, -48); context.closePath(); context.fill();
  } else if (style.headwear !== "none") {
    ellipse(0, -53, 41, 22, hat); context.fillStyle = hat; context.fillRect(-44, -56, 88, 10);
    if (style.headwear === "firefighter") { context.fillStyle = "#efcf77"; context.fillRect(-7, -68, 14, 17); }
    if (style.headwear === "beanie") ellipse(0, -78, 8, 8, hat);
  }
  if (style.eyewear === "round") {
    context.strokeStyle = hat; context.lineWidth = 3;
    for (const x of [-15, 15]) { context.beginPath(); context.arc(x, -25, 12, 0, Math.PI * 2); context.stroke(); }
  } else if (style.eyewear === "visor") { context.fillStyle = "#426a80"; context.fillRect(-30, -34, 60, 15); }
  context.restore();
  context.save(); context.scale(canvas.width / 256, canvas.height / 224);
  context.fillStyle = "#ad567d"; context.font = "bold 30px sans-serif"; context.fillText("!", 207, 57 + wobble * 3);
  context.strokeStyle = "#cc88ab"; context.lineWidth = 3;
  for (const side of [-1, 1]) { context.beginPath(); context.moveTo(128 + side * 86, 91); context.lineTo(128 + side * 96, 82 - wobble * 3); context.stroke(); }
  context.restore();
}
