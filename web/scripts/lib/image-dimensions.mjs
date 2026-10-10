/**
 * 从图片文件头读出像素尺寸，不依赖任何解码库。
 *
 * 用途：导入脚本要把「卡片按原图比例自适应显示」所需的宽高写进目录 JSON。
 * `Bun.Image` 的 width/height 反映的是 resize 目标而不是源尺寸（实测读 560 会
 * 返回 560、对源尺寸一无所知，metadata() 也是空对象），所以这里自己解文件头。
 *
 * 只覆盖本项目实际用到的两种格式：WebP（缩略图）与 JPEG（打包原创素材）。
 * 认不出来就返回 null —— 调用方应当接受"没有尺寸"，卡片只是退回等图片自己报。
 */

/** RIFF 容器里的 VP8 帧头：宽高各占 14 bit，低 2 bit 是缩放系数。 */
function readVp8(view) {
    // 起始码 0x9d 0x01 0x2a 之后紧跟宽高。
    if (view.getUint8(23) !== 0x9d || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
}

/** VP8L 无损：14 bit 宽 + 14 bit 高，紧密打包在 4 字节里，存的是「值 - 1」。 */
function readVp8l(view) {
    if (view.getUint8(20) !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

/** VP8X 扩展容器：画布宽高各 24 bit，同样存「值 - 1」。 */
function readVp8x(view) {
    const width = view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const height = view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return { width: width + 1, height: height + 1 };
}

function readWebp(view) {
    if (view.byteLength < 30) return null;
    const fourcc = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    if (fourcc === "VP8 ") return readVp8(view);
    if (fourcc === "VP8L") return readVp8l(view);
    if (fourcc === "VP8X") return readVp8x(view);
    return null;
}

/** JPEG：扫到第一个 SOFn 段，段内偏移 5/7 各是 16 bit 大端的高与宽。 */
function readJpeg(view) {
    let offset = 2;
    while (offset + 9 < view.byteLength) {
        if (view.getUint8(offset) !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = view.getUint8(offset + 1);
        // 填充字节与无载荷的标记直接跳过。
        if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2;
            continue;
        }
        const length = view.getUint16(offset + 2, false);
        // SOF0/1/2/3、5/6/7、9/10/11、13/14/15 都是带尺寸的帧头。
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
            return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) };
        }
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
}

/**
 * @param {Uint8Array} bytes 图片文件的完整字节
 * @returns {{ width: number, height: number } | null}
 */
export function imageDimensions(bytes) {
    if (!bytes || bytes.byteLength < 16) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, false) === 0xffd8) return readJpeg(view);
    if (view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57454250) return readWebp(view);
    return null;
}
