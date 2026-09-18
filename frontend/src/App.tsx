import './App.css'
import { StockSearch } from './components/StockSearch/StockSearch.tsx'

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Halal Stocks</h1>
      </header>
      <main className="app-main">
        <StockSearch />
      </main>
    </div>
  )
}

export default App
