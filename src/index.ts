import { createApp } from './app';
import { config, validateConfig } from './config/env';
import { logger } from './utils/logger';
import { thirdwebService } from './services/thirdweb.service';
import { zkProofService } from './services/zkproof.service';
import { ingestionService } from './services/ingestion.service';

/**
 * NexusPay Receipt Engine
 * Main entry point
 */
async function bootstrap() {
  try {
    logger.info('Starting NexusPay Receipt Engine...');
    
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');
    
    // Initialize services
    await thirdwebService.initialize();
    await zkProofService.initialize();
    logger.info('Services initialized');
    
    // Create Express app
    const app = createApp();
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info('Receipt Engine started', {
        port: config.port,
        env: config.nodeEnv,
        network: config.thirdweb.network,
      });
    });
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Cleanup services
        await ingestionService.shutdown();
        
        logger.info('Shutdown complete');
        process.exit(0);
      });
      
      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 30000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection', { reason });
      process.exit(1);
    });
    
  } catch (error: any) {
    logger.error('Failed to start Receipt Engine', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Start the application
bootstrap();

