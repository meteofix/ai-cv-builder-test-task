import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { ConnectionBanner } from './components/ConnectionBanner';
import { AuthPage } from './pages/AuthPage';
import { CvListPage } from './pages/CvListPage';
import { CvPage } from './pages/CvPage';
import { NewCvPage } from './pages/NewCvPage';

export function App() {
  return (
    <div className="app">
      <ConnectionBanner />
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <CvListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cvs/new"
          element={
            <RequireAuth>
              <NewCvPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cvs/:id"
          element={
            <RequireAuth>
              <CvPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
