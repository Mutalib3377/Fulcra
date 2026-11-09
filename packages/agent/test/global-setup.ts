import { getTestDatabaseUrl, prepareTestDatabase } from '@fulcra/db/testing';

export default async function setup() {
  await prepareTestDatabase(getTestDatabaseUrl());
}
