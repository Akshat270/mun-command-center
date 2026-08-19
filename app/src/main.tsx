import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles.css'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { LiveRoom } from './pages/LiveRoom'
import { Speeches } from './pages/Speeches'
import { POIs } from './pages/POIs'
import { Research } from './pages/Research'
import { Countries } from './pages/Countries'
import { CountryDetail } from './pages/CountryDetail'
import { Resolution } from './pages/Resolution'
import { Notes } from './pages/Notes'
import { Motions } from './pages/Motions'
import { Practice } from './pages/Practice'
import { Settings } from './pages/Settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="live" element={<LiveRoom />} />
          <Route path="speeches" element={<Speeches />} />
          <Route path="pois" element={<POIs />} />
          <Route path="research" element={<Research />} />
          <Route path="countries" element={<Countries />} />
          <Route path="countries/:code" element={<CountryDetail />} />
          <Route path="resolution" element={<Resolution />} />
          <Route path="notes" element={<Notes />} />
          <Route path="motions" element={<Motions />} />
          <Route path="practice" element={<Practice />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
