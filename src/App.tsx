import { Routes, Route } from 'react-router-dom';
import Sidebar from './ui/Sidebar';
import { Panel, Calendar, Transactions, Budgets, Goals, Salaries, Settings } from './pages';

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Panel />} />
          <Route path="/calendario" element={<Calendar />} />
          <Route path="/transacoes" element={<Transactions />} />
          <Route path="/orcamentos" element={<Budgets />} />
          <Route path="/metas" element={<Goals />} />
          <Route path="/salarios" element={<Salaries />} />
          <Route path="/definicoes" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
