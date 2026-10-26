import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { Claim } from './pages/Claim'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { ResetPassword } from './pages/ResetPassword'

const Requests = lazy(() => import('./pages/Requests'))
const RequestNew = lazy(() => import('./pages/RequestNew'))
const RequestDetail = lazy(() => import('./pages/RequestDetail'))
const Ccrs = lazy(() => import('./pages/Ccrs'))
const Documents = lazy(() => import('./pages/Documents'))
const Responsibilities = lazy(() => import('./pages/Responsibilities'))
const Incidents = lazy(() => import('./pages/Incidents'))
const Meetings = lazy(() => import('./pages/Meetings'))
const Finances = lazy(() => import('./pages/Finances'))
const Budget = lazy(() => import('./pages/Budget'))
const Chat = lazy(() => import('./pages/Chat'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Search = lazy(() => import('./pages/Search'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const Admin = lazy(() => import('./pages/Admin'))

function Loading() {
  return <div className="empty">Loading…</div>
}

function Gate() {
  const { loading, session, profile } = useAuth()
  if (loading) return <Loading />
  if (!session) {
    return (
      <Routes>
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  if (!profile) return <Claim />
  if (!profile.active) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h2>Account paused</h2>
          <p>An admin has paused this account. Contact the site admin if you think this is a mistake.</p>
        </div>
      </div>
    )
  }
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/reset" element={<ResetPassword />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="requests" element={<Requests />} />
          <Route path="requests/new" element={<RequestNew />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="ccrs" element={<Ccrs />} />
          <Route path="ccrs/:section" element={<Ccrs />} />
          <Route path="documents" element={<Documents />} />
          <Route path="responsibilities" element={<Responsibilities />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="finances" element={<Finances />} />
          <Route path="budget" element={<Budget />} />
          <Route path="chat" element={<Chat />} />
          <Route path="chat/:id" element={<Chat />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="search" element={<Search />} />
          <Route path="profile" element={<ProfilePage />} />
          {profile.role === 'admin' && <Route path="admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
