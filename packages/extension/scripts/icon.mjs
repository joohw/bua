import { deflateSync } from 'node:zlib';

/** PNG 的 CRC32。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 共用品牌图标：页面强调色圆角底、浏览器窗口与操作指针。
 * 在同一归一化画布上生成各尺寸，8× 超采样保证工具栏边缘清晰。
 *
 * @param {number} size - 边长（像素）
 */
export function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  function roundedRect(x, y, left, top, right, bottom, radius) {
    const dx = Math.max(left + radius - x, 0, x - (right - radius));
    const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
    return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
  }
  function polygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Quadratic corner transitions keep the pointer tip and notch smooth at every size.
  const vertices = [[52, 47], [81, 67], [69, 70], [63, 83]];
  const cursor = [];
  for (let i = 0; i < vertices.length; i++) {
    const corner = vertices[i];
    const previous = vertices[(i + vertices.length - 1) % vertices.length];
    const next = vertices[(i + 1) % vertices.length];
    const inset = (point) => {
      const length = Math.hypot(point[0] - corner[0], point[1] - corner[1]);
      return corner.map((value, axis) => value + (point[axis] - value) * 5 / length);
    };
    const a = inset(previous), b = inset(next);
    for (let step = 0; step <= 12; step++) {
      const t = step / 12;
      cursor.push(corner.map((value, axis) => (1 - t) ** 2 * a[axis] + 2 * (1 - t) * t * value + t ** 2 * b[axis]));
    }
  }
  // A brand-colored outline separates the pointer from the window frame.
  function nearCursor(x, y) {
    if (x < 48 || x > 85 || y < 43 || y > 87) return false;
    for (let i = 0; i < cursor.length; i++) {
      const a = cursor[i], b = cursor[(i + 1) % cursor.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      if ((x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 <= 3.5 ** 2) return true;
    }
    return false;
  }
  function sample(x, y) {
    if (!roundedRect(x, y, 3, 3, 97, 97, 23)) return [0, 0, 0, 0];
    let color = [171, 70, 54, 255];
    if (roundedRect(x, y, 20, 24, 80, 73, 9)) color = [251, 250, 249, 255];
    if (roundedRect(x, y, 26, 39, 74, 67, 3)) color = [171, 70, 54, 255];
    if (y >= 30 && y <= 34 && x >= 28 && x <= 40) color = [171, 70, 54, 255];
    if (nearCursor(x, y)) color = [171, 70, 54, 255];
    if (polygon(x, y, cursor)) color = [251, 250, 249, 255];
    return color;
  }

  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; // filter type: none
    p += 1;
    for (let x = 0; x < size; x += 1) {
      const channels = [0, 0, 0, 0];
      for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
        const color = sample((x + (sx + .5) / 8) * 100 / size, (y + (sy + .5) / 8) * 100 / size);
        for (let c = 0; c < 3; c++) channels[c] += color[c] * color[3] / 255;
        channels[3] += color[3];
      }
      for (let c = 0; c < 3; c++) raw[p + c] = channels[3] ? Math.round(channels[c] * 255 / channels[3]) : 0;
      raw[p + 3] = Math.round(channels[3] / 64);
      p += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

