/**
 * 语言选项列表
 */
export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'vi', label: 'Tiếng Việt' },
];

/**
 * 翻译器选项
 */
export const TRANSLATORS = [
  { value: 'unified', label: 'HY-MT (本地)' },
  { value: 'libretranslate', label: 'LibreTranslate' },
  { value: 'none', label: '不翻译' },
];

/**
 * OCR 模型类型选项
 */
export const OCR_MODELS = [
  { value: 'mobile', label: 'Mobile (快速)' },
  { value: 'server', label: 'Server (精准)' },
];

/**
 * 根据语言代码获取语言名称
 */
export const getLangName = (code) => {
  const lang = LANGUAGES.find(l => l.value === code);
  return lang ? lang.label : code.toUpperCase();
};
