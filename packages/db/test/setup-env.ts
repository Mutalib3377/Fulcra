import { getTestDatabaseUrl } from '../src/testing';

// Each test worker uses the test database, never the development one.
process.env.DATABASE_URL = getTestDatabaseUrl();
