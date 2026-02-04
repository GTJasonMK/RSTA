import React from 'react';

/**
 * 设置分组容器
 */
export const SettingGroup = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-stone-100 shadow-card overflow-hidden">
    <div className="px-5 py-3 border-b border-stone-100">
      <h3 className="font-semibold text-stone-800 text-sm">{title}</h3>
    </div>
    <div className="p-5 space-y-5">{children}</div>
  </div>
);

/**
 * 设置行
 */
export const SettingRow = ({ label, description, children }) => (
  <div className="flex items-start justify-between gap-6">
    <div className="flex-1 min-w-0">
      <div className="text-sm text-stone-700">{label}</div>
      {description && <div className="text-xs text-stone-400 mt-0.5">{description}</div>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

/**
 * 输入框
 */
export const Input = ({ value, onChange, type = 'text', className = '', ...props }) => (
  <input
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700
      placeholder:text-stone-400
      focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20
      transition-all duration-150 ${className}`}
    {...props}
  />
);

/**
 * 下拉选择框
 */
export const Select = ({ value, onChange, options, className = '', disabled = false }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className={`bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700
      focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20
      disabled:opacity-50 disabled:cursor-not-allowed
      transition-all duration-150 appearance-none cursor-pointer
      bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20fill%3D%22%2378716c%22%20viewBox%3D%220%200%2016%2016%22%3E%3Cpath%20d%3D%22M4.5%206l3.5%203.5L11.5%206%22%20stroke%3D%22%2378716c%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')]
      bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat pr-8 ${className}`}
  >
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

/**
 * 开关按钮
 */
export const Toggle = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
      checked ? 'bg-amber-500' : 'bg-stone-200'
    }`}
  >
    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
      checked ? 'left-[22px]' : 'left-0.5'
    }`} />
  </button>
);
