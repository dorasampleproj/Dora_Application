import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './Dashboard';
import MetricDetails from './MetricDetails';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/details" element={<MetricDetails />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
