import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    message: 'Server is running with new organized structure',
  });
});

// Basic API endpoint for testing
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Code organization successful!',
    structure: {
      server: 'src/server/',
      client: 'src/client/',
      shared: 'src/shared/',
    },
  });
});

// 404 handler for unmatched API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      error: 'Not Found',
      message: `API endpoint ${req.originalUrl} not found`,
      timestamp: new Date().toISOString(),
    });
  } else {
    next();
  }
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    console.log(`✅ Code organization complete - new structure active!`);
  });
}

export { app };
export default app;
