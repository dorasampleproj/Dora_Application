const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const githubRoutes = require('./routes/github');
const servicenowRoutes = require('./routes/servicenow');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/data-sources', githubRoutes);
// Mount ServiceNow mock metrics under /api/servicenow
app.use('/api/servicenow', servicenowRoutes);

app.get('/api/incidents', (req, res) => {
  res.json([
    { id: 1, status: 'open', created: '2025-12-01', resolved: '2025-12-02' },
    { id: 2, status: 'closed', created: '2025-12-03', resolved: '2025-12-04' }
  ]);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});