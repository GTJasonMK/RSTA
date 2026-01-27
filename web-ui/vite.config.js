import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',

  // 开发服务器优化
  server: {
    port: 5173,
    strictPort: true,
    // 减少文件监听范围，加速启动
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**']
    }
  },

  // 依赖预构建优化（加速开发启动）
  optimizeDeps: {
    // 预构建常用依赖
    include: ['react', 'react-dom', 'lucide-react'],
    // 排除不需要预构建的
    exclude: []
  },

  // 构建优化
  build: {
    // 代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'icons': ['lucide-react']
        }
      }
    },
    // 减小打包体积
    minify: 'esbuild',
    // 关闭 sourcemap 加速构建
    sourcemap: false
  },

  // 减少日志输出
  logLevel: 'warn'
})
