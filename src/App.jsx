import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import MapPage from './pages/MapPage'
import Dashboard from './pages/Dashboard'
import RegisterNode from './pages/RegisterNode'
import AboutPage from './pages/AboutPage'
import DonatePrompt from './components/DonatePrompt'
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
            <Route path="/about" element={<AboutPage />} />
          </Routes>
        </main>
        <DonatePrompt />
      </div>
    </BrowserRouter>
  )
}

export default App