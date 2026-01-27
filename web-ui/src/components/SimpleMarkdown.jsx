import React from 'react';

/**
 * 简单的 Markdown 渲染组件
 * 支持：粗体、标题（【】格式）、有序列表、无序列表
 */
const SimpleMarkdown = ({ content, className = '' }) => {
  if (!content) return null;

  // 解析内容为段落
  const parseContent = (text) => {
    const lines = text.split('\n');
    const elements = [];
    let currentList = null;
    let listItems = [];
    let listType = null;

    const flushList = () => {
      if (listItems.length > 0) {
        if (listType === 'ol') {
          elements.push(
            <ol key={`list-${elements.length}`} className="list-decimal list-inside space-y-0.5 my-1">
              {listItems}
            </ol>
          );
        } else {
          elements.push(
            <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-0.5 my-1">
              {listItems}
            </ul>
          );
        }
        listItems = [];
        listType = null;
      }
    };

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      // 空行
      if (!trimmedLine) {
        flushList();
        return;
      }

      // 【标题】格式
      if (trimmedLine.startsWith('【') && trimmedLine.includes('】')) {
        flushList();
        const titleEnd = trimmedLine.indexOf('】');
        const title = trimmedLine.slice(1, titleEnd);
        const rest = trimmedLine.slice(titleEnd + 1).trim();
        elements.push(
          <div key={`title-${index}`} className="font-bold text-amber-400 mt-2 mb-1 first:mt-0">
            {title}
          </div>
        );
        if (rest) {
          elements.push(
            <div key={`title-rest-${index}`} className="mb-1">
              {parseInline(rest)}
            </div>
          );
        }
        return;
      }

      // 有序列表：1. 2. 等
      const olMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
      if (olMatch) {
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listItems.push(
          <li key={`li-${index}`} className="text-stone-300">
            {parseInline(olMatch[2])}
          </li>
        );
        return;
      }

      // 无序列表：- 或 * 开头
      const ulMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listItems.push(
          <li key={`li-${index}`} className="text-stone-300">
            {parseInline(ulMatch[1])}
          </li>
        );
        return;
      }

      // 普通段落
      flushList();
      elements.push(
        <div key={`p-${index}`} className="mb-1 last:mb-0">
          {parseInline(trimmedLine)}
        </div>
      );
    });

    flushList();
    return elements;
  };

  // 解析行内格式：**粗体**
  const parseInline = (text) => {
    const parts = [];
    let remaining = text;
    let keyIndex = 0;

    while (remaining) {
      // 匹配 **粗体**
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      if (boldMatch) {
        const beforeBold = remaining.slice(0, boldMatch.index);
        if (beforeBold) {
          parts.push(<span key={keyIndex++}>{beforeBold}</span>);
        }
        parts.push(
          <strong key={keyIndex++} className="text-white font-semibold">
            {boldMatch[1]}
          </strong>
        );
        remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      } else {
        parts.push(<span key={keyIndex++}>{remaining}</span>);
        break;
      }
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className={`simple-markdown ${className}`}>
      {parseContent(content)}
    </div>
  );
};

export default SimpleMarkdown;
