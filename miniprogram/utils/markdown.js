/**
 * 极简 Markdown → HTML（rich-text 渲染，nodes 传 HTML 字符串）
 * 支持：标题(#~####)、加粗、斜体、行内代码、引用、有序/无序列表、图片、链接（仅样式不可跳转）、分割线
 * 设计取舍：小程序端不引入完整 md 库，专题正文场景够用； XSS 由先转义 HTML 再生成标签兜底
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内元素（图片优先于链接；链接在小程序内不可跳转，渲染为主题色文本） */
function inline(s) {
  return s
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
      '<img src="$2" style="max-width:100%;border-radius:8px;margin:8px 0;" />'
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<span style="color:#2b6cf6;">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /`([^`]+)`/g,
      '<code style="background:#f2f3f5;padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>'
    );
}

const H_STYLE = 'font-weight:700;color:#1f2329;margin:14px 0 8px;';
const H_STYLES = {
  1: `font-size:21px;${H_STYLE}`,
  2: `font-size:19px;${H_STYLE}`,
  3: `font-size:17px;${H_STYLE}`,
  4: `font-size:15px;${H_STYLE}`,
};

/** markdown 正文 → HTML 字符串 */
function markdownToHtml(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  let listType = ''; // 'ul' | 'ol'
  let para = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = '';
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p style="margin:8px 0;line-height:1.75;font-size:15px;color:#1f2329;">${inline(escapeHtml(para.join(' ')))}</p>`);
      para = [];
    }
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      closeList();
      return;
    }

    // 标题
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      out.push(`<h${h[1].length + 1} style="${H_STYLES[h[1].length]}">${inline(escapeHtml(h[2]))}</h${h[1].length + 1}>`);
      return;
    }
    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      closeList();
      out.push('<hr style="border:none;border-top:1px solid #e5e6eb;margin:14px 0;" />');
      return;
    }
    // 引用（连续 > 行合并）
    if (trimmed.startsWith('> ')) {
      flushPara();
      closeList();
      out.push(
        `<blockquote style="border-left:3px solid #d8dee9;padding:4px 12px;margin:8px 0;color:#8a93a6;">${inline(escapeHtml(trimmed.slice(2)))}</blockquote>`
      );
      return;
    }
    // 无序列表
    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul && !/^[-*]{3,}$/.test(trimmed)) {
      flushPara();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul style="padding-left:20px;margin:6px 0;">');
        listType = 'ul';
      }
      out.push(`<li style="margin:3px 0;line-height:1.7;font-size:15px;color:#1f2329;">${inline(escapeHtml(ul[1]))}</li>`);
      return;
    }
    // 有序列表
    const ol = trimmed.match(/^\d+[.、]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol style="padding-left:20px;margin:6px 0;">');
        listType = 'ol';
      }
      out.push(`<li style="margin:3px 0;line-height:1.7;font-size:15px;color:#1f2329;">${inline(escapeHtml(ol[1]))}</li>`);
      return;
    }
    // 普通文本行 → 段落（相邻行合并，同 md 段落语义）
    closeList();
    para.push(trimmed);
  });

  flushPara();
  closeList();
  return out.join('');
}

module.exports = { markdownToHtml };
