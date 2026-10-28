import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { ConnectionBanner } from './components/ConnectionBanner';
import { AppHeader } from './components/AppHeader';
import { AuthPage } from './pages/AuthPage';

/** Replaced by the real screens in task 3.2; the routes and the guard are final. */
function Placeholder({ title }: { title: string }) {
  return (
    <>
      <AppHeader />
      <main className="generation">
        <h1 className="auth__title">{title}</h1>
      </main>
    </>
  );
}

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
              <Placeholder title="Your CVs" />
            </RequireAuth>
          }
        />
        <Route
          path="/cvs/new"
          element={
            <RequireAuth>
              <Placeholder title="New CV" />
            </RequireAuth>
          }
        />
        <Route
          path="/cvs/:id"
          element={
            <RequireAuth>
              <Placeholder title="CV" />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
