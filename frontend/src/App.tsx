import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { DatosProvider } from './estado/DatosContexto';
import Dashboard from './pages/Dashboard';
import Results from './pages/Results';
import Charts from './pages/Charts';
import Config from './pages/Config';
import Registros from './pages/Registros';

function App() {
  return (
    <Router>
      <DatosProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/results" element={<Results />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/config" element={<Config />} />
          <Route path="/registros" element={<Registros />} />
        </Routes>
      </Layout>
      </DatosProvider>
    </Router>
  );
}

export default App;
