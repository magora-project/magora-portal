import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import MapPage from './pages/MapPage'
import Dashboard from './pages/Dashboard'
import RegisterNode from './pages/RegisterNode'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<MapPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/register" element={<RegisterNode />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App