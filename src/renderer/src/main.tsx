import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initTheme } from './lib/theme'

// 首帧渲染前恢复上次选择的主题（默认暗色）
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
