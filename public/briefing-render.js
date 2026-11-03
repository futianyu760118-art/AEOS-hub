// 今日风险简报渲染：Markdown → HTML。
// 简报里最关键的是齐套风险表；modal 原先用 <pre> 原样显示 Markdown，
// 表头与数据列无法对齐，这里按简报的实际结构做最小渲染（标题/列表/表格/分隔线）。

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function isTableLine(line) {
  return /^\s*\|/.test(line);
}

/** 按未转义的 | 切列；cell() 在生成简报时会把单元格内的 | 转义成 \|。 */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((text) => /^:?-{3,}:?$/.test(text));
}

function cellClass(text) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return ' class="evidence"';
  if (/^[¥$]?-?[\d,]+(?:\.\d+)?%?$/.test(text)) return ' class="num"';
  return '';
}

function renderTable(block) {
  const rows = block.map(splitRow).filter((cells) => !isSeparatorRow(cells));
  if (!rows.length) return '';
  const [header, ...body] = rows;
  const head = header.map((text) => `<th>${escapeHtml(text)}</th>`).join('');
  const bodyHtml = body.map((cells) => {
    const tds = cells.map((text) => `<td${cellClass(text)}>${escapeHtml(text)}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<div class="briefing-table-wrap"><table class="briefing-table">`
    + `<thead><tr>${head}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

export function renderBriefingMarkdown(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const html = [];
  let listItems = null;
  const flushList = () => {
    if (listItems) html.push(`<ul>${listItems.join('')}</ul>`);
    listItems = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*$/.test(line)) { flushList(); continue; }

    if (isTableLine(line)) {
      flushList();
      const block = [];
      while (index < lines.length && isTableLine(lines[index])) {
        block.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(renderTable(block));
      continue;
    }

    flushList();

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // modal 自身已有 h2 标题，正文标题从 h3 起，避免出现第二个主标题。
      const level = Math.min(6, heading[1].length + 2);
      html.push(`<h${level}>${escapeHtml(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^-\s+/.test(line)) {
      listItems = listItems ?? [];
      listItems.push(`<li>${escapeHtml(line.replace(/^-\s+/, ''))}</li>`);
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) { html.push('<hr>'); continue; }

    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return html.join('');
}
