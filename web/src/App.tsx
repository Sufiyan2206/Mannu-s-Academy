import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { Spinner } from './ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Classes from './pages/Classes'
import ClassDetailPage from './pages/ClassDetail'
import Users from './pages/Users'
import Account from './pages/Account'
import Fees from './pages/Fees'
import MyAttendance from './pages/MyAttendance'
import Reports from './pages/Reports'

const NAV: Record<string, [string, string][]> = {
  admin: [['/', 'Home'], ['/students', 'Students'], ['/classes', 'Classes'], ['/reports', 'Reports'], ['/fees', 'Fees'], ['/users', 'Users'], ['/account', 'Account']],
  teacher: [['/', 'Home'], ['/classes', 'Classes'], ['/reports', 'Reports'], ['/students', 'Students'], ['/account', 'Account']],
  student: [['/', 'Home'], ['/classes', 'Classes'], ['/attendance', 'Attendance'], ['/fees', 'Fees'], ['/account', 'Account']],
}

export default function App() {
  const { user, cfg, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner />
  if (!user || !cfg) return <Login />
  const nav = NAV[user.role]
  return (
    <>
      <header className="top">
        <span className="logo" aria-hidden="true"><img src="/brand/logo-emblem-64.webp" alt="" width={30} height={27} /></span>
        <b>{cfg.academy}</b>
        <span className="who" aria-label="Signed in as">{user.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
      </header>
      <main id="main" key={loc.pathname.split('/')[1]}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/students" element={user.role === 'student' ? <Navigate to="/" /> : <Students />} />
          <Route path="/classes" element={<Classes />} />
          <Route path="/classes/:id" element={<ClassDetailPage />} />
          <Route path="/fees" element={user.role === 'teacher' ? <Navigate to="/" /> : <Fees />} />
          <Route path="/reports" element={user.role === 'student' ? <Navigate to="/" /> : <Reports />} />
          <Route path="/reports/:id" element={user.role === 'student' ? <Navigate to="/" /> : <Reports />} />
          <Route path="/attendance" element={user.role === 'student' ? <MyAttendance /> : <Navigate to="/reports/att-student" />} />
          <Route path="/users" element={user.role === 'admin' ? <Users /> : <Navigate to="/" />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="tabs" aria-label="Main">
        {nav.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{label}</NavLink>)}
      </nav>
    </>
  )
}
