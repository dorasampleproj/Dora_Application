const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const githubRoutes = require('./routes/github');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/data-sources', githubRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});