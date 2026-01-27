import React, { useState, useEffect } from 'react';

/**
 * 截图选区组件
 * 用于在屏幕上绘制选区框进行截图
 */
const Snipper = ({ onComplete, onCancel }) => {
  const [startPos, setStartPos] = useState(null);
  const [currPos, setCurrentPos] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleMouseDown = (e) => {
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentPos({ x: e.clientX, y: e.clientY });
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    setCurrentPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (!startPos || !currPos) return;
    const x = Math.min(startPos.x, currPos.x);
    const y = Math.min(startPos.y, currPos.y);
    const width = Math.abs(currPos.x - startPos.x);
    const height = Math.abs(currPos.y - startPos.y);
    if (width > 10 && height > 10) {
      onComplete({ x, y, width, height });
    }
    setStartPos(null);
    setCurrentPos(null);
  };

  const getStyle = () => {
    if (!startPos || !currPos) return {};
    return {
      position: 'absolute',
      left: Math.min(startPos.x, currPos.x),
      top: Math.min(startPos.y, currPos.y),
      width: Math.abs(currPos.x - startPos.x),
      height: Math.abs(currPos.y - startPos.y),
      border: '2px solid #F59E0B',
      backgroundColor: 'rgba(245, 158, 11, 0.2)',
    };
  };

  return (
    <div className="fixed inset-0 cursor-crosshair bg-black/30 z-50"
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      {isDrawing && <div style={getStyle()} />}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg text-sm font-medium text-stone-700">
        拖动选择区域 (ESC 取消)
      </div>
    </div>
  );
};

export default Snipper;
