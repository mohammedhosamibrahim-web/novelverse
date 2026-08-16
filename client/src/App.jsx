import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import InstallBanner from './components/InstallBanner';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Browse from './pages/Browse';
import MangaDetail from './pages/MangaDetail';
import NovelDetail from './pages/NovelDetail';
import MangaReader from './pages/MangaReader';
import NovelReader from './pages/NovelReader';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import Admin from './pages/Admin';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/manga/:id" element={<MangaDetail />} />
          <Route path="/novel/:id" element={<NovelDetail />} />
          <Route path="/reader/manga/:mangaId/:chapterId" element={<MangaReader />} />
          <Route path="/reader/novel/:novelId/:index" element={<NovelReader />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
      <InstallBanner />
    </div>
  );
}
