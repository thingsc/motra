import React from 'react'
import ReactDOM from 'react-dom/client'
import { ScopeWindow } from './ScopeWindow'
import '../index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ScopeWindow />
  </React.StrictMode>
)