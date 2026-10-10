/**
 * 一次性迁移：把本地缩略图的真实像素尺寸补进灵感目录 JSON。
 *
 * 背景：卡片改成按原图比例自适应显示（不裁切）后，需要在图片到达前就按真实比例
 * 占位，否则图片没到之前卡片高度是 0，整面瀑布会边加载边上下抽动。
 * `import-inspirations.mjs` 从现在起会写入 width/height，但已经落盘的目录里没有，
 * 这个脚本负责补齐——只读本地文件，不联网。
 *
 * 可以安全地重复执行：会把已有的尺寸重新算一遍写成同样的值。
 * 上游远程图（image 是 http(s) 链接、没有本地缩略图的条目）拿不到尺寸，保持原样，
 * 那种卡片只能等图片自己报尺寸。
 *
 * 用法：bun scripts/backfill-thumb-dimensions.mjs && bunx prettier --write public/inspirations
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { imageDimensions } from "./lib/image-dimensions.mjs";

const WEB_DIR = resolve(import.meta.dir, "..");
const PUBLIC_DIR = join(WEB_DIR, "public", "inspirations");
const FILES = ["gallery-pool.json", "seedance.json", "haohaoxue.json", "youmind.json"];

let patched = 0;
let already = 0;
let remote = 0;
const missing = [];

for (const file of FILES) {
    const path = join(PUBLIC_DIR, file);
    if (!existsSync(path)) {
        console.warn(`跳过不存在的文件: ${file}`);
        continue;
    }
    const payload = JSON.parse(readFileSync(path, "utf8"));
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    let filePatched = 0;

    for (const entry of entries) {
        const image = typeof entry.image === "string" ? entry.image : "";
        // 只处理本地资源；上游 CDN 图不在磁盘上，量不出尺寸。
        if (!image.startsWith("/")) {
            remote += 1;
            continue;
        }
        const asset = join(WEB_DIR, "public", image);
        if (!existsSync(asset)) {
            missing.push(image);
            continue;
        }
        const size = imageDimensions(readFileSync(asset));
        if (!size) {
            missing.push(image);
            continue;
        }
        if (entry.width === size.width && entry.height === size.height) {
            already += 1;
            continue;
        }
        entry.width = size.width;
        entry.height = size.height;
        patched += 1;
        filePatched += 1;
    }

    // 序列化方式与 import-inspirations.mjs 保持一致（紧凑写盘），格式交给 prettier。
    writeFileSync(path, JSON.stringify(payload), "utf8");
    console.log(`${file.padEnd(20)} 条目 ${String(entries.length).padStart(4)}，本次补写尺寸 ${filePatched}`);
}

console.log(`\n补写 ${patched} 条，已是目标值 ${already} 条，远程图跳过 ${remote} 条`);
if (missing.length) console.warn(`找不到或读不出尺寸的本地资源 ${missing.length} 个:\n  ${[...new Set(missing)].slice(0, 10).join("\n  ")}`);
