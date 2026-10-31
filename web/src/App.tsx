import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppNav, Footer, ScrollToTop } from "./components/layout/AppShell";
import { NotFoundBody, SourceLayout } from "./components/layout/SourceLayout";
import { RealDataLayout } from "./components/layout/RealDataLayout";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import LocationsPage from "./pages/LocationsPage";
import LocationPage from "./pages/LocationPage";
import SystemPage from "./pages/SystemPage";
import CardiologistsPage from "./pages/CardiologistsPage";
import CardiologistPage from "./pages/CardiologistPage";
import GroupsPage from "./pages/GroupsPage";
import GroupPage from "./pages/GroupPage";
import SignalsPage from "./pages/SignalsPage";
import SignalPage from "./pages/SignalPage";
import RealDashboardPage from "./pages/real/RealDashboardPage";
import { RealLocationPage, RealLocationsPage } from "./pages/real/RealLocationPages";
import { RealCardiologistPage, RealCardiologistsPage } from "./pages/real/RealCardiologistPages";
import { RealGroupsPage, RealNoSystems, RealSignalPage, RealSignalsPage } from "./pages/real/RealSignalAndGroupPages";

function Shell() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <AppNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** Route table, separate from the router so tests can mount it in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<LandingPage />} />
        {/* Real data: its own layout and pages (real records, empty signals, no score).
            A static segment outranks :source, so /public/* always lands here. */}
        <Route path="public" element={<RealDataLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<RealDashboardPage />} />
          <Route path="locations" element={<RealLocationsPage />} />
          <Route path="locations/:slug" element={<RealLocationPage />} />
          <Route path="systems/:slug" element={<RealNoSystems />} />
          <Route path="cardiologists" element={<RealCardiologistsPage />} />
          <Route path="cardiologists/:npi" element={<RealCardiologistPage />} />
          <Route path="groups" element={<RealGroupsPage />} />
          <Route path="groups/:id" element={<RealGroupsPage />} />
          <Route path="signals" element={<RealSignalsPage />} />
          <Route path="signals/:key" element={<RealSignalPage />} />
          <Route path="*" element={<NotFoundBody />} />
        </Route>
        <Route path=":source" element={<SourceLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="locations/:slug" element={<LocationPage />} />
          <Route path="systems/:slug" element={<SystemPage />} />
          <Route path="cardiologists" element={<CardiologistsPage />} />
          <Route path="cardiologists/:npi" element={<CardiologistPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:id" element={<GroupPage />} />
          <Route path="signals" element={<SignalsPage />} />
          <Route path="signals/:key" element={<SignalPage />} />
          <Route path="*" element={<NotFoundBody />} />
        </Route>
        <Route path="*" element={<NotFoundBody />} />
      </Route>
    </Routes>
  );
}

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export default function App() {
  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      <AppRoutes />
    </BrowserRouter>
  );
}
