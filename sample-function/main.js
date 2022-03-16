// ../../app/functions/sample-function/main.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// ../../app/functions/sample-function/utils/test.ts
function test() {
  console.log("hello test");
}

// ../../app/functions/sample-function/main.ts
function handler(event) {
  const dynamodb = new DynamoDBClient({});
  test();
  return {
    status: 200,
    body: JSON.stringify({
      message: "Hello world"
    })
  };
}
export {
  handler
};