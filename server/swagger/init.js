const swaggerAutogen = require("swagger-autogen")({ openapi: "3.0.0" });
const fs = require("fs");
const path = require("path");

const doc = {
  info: {
    version: "1.0.0",
    title: "VertexAI Developer API",
    description:
      "API endpoints that enable programmatic reading, writing, and updating of your VertexAI instance. UI supplied by Swagger.io.",
  },
  // Swagger-autogen does not allow us to use relative paths as these will resolve to
  // http:///api in the openapi.json file, so we need to monkey-patch this post-generation.
  host: "/api",
  schemes: ["http"],
  securityDefinitions: {
    BearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    },
  },
  security: [{ BearerAuth: [] }],
  definitions: {
    InvalidAPIKey: {
      message: "Invalid API Key",
    },
  },
};

const outputFile = path.resolve(__dirname, "./openapi.json");

// Use paths relative to the swagger directory for swagger-autogen compatibility
// swagger-autogen expects forward slashes even on Windows
const endpointsDir = path.resolve(__dirname, "../endpoints/api").replace(/\\/g, '/');
const endpointsFiles = [
  `${endpointsDir}/auth/index.js`,
  `${endpointsDir}/admin/index.js`,
  `${endpointsDir}/document/index.js`,
  `${endpointsDir}/workspace/index.js`,
  `${endpointsDir}/system/index.js`,
  `${endpointsDir}/workspaceThread/index.js`,
  `${endpointsDir}/userManagement/index.js`,
  `${endpointsDir}/openai/index.js`,
  `${endpointsDir}/embed/index.js`,
];

swaggerAutogen(outputFile, endpointsFiles, doc).then(({ data }) => {
  // Handle case where swagger-autogen fails to parse files
  if (!data || !data.paths) {
    console.error("Swagger-autogen: \x1b[31mFailed to generate OpenAPI spec - no paths found\x1b[0m");
    process.exit(1);
  }

  // Remove Authorization parameters from arguments.
  for (const pathKey of Object.keys(data.paths)) {
    if (data.paths[pathKey].hasOwnProperty("get")) {
      let parameters = data.paths[pathKey].get?.parameters || [];
      parameters = parameters.filter((arg) => arg.name !== "Authorization");
      data.paths[pathKey].get.parameters = parameters;
    }

    if (data.paths[pathKey].hasOwnProperty("post")) {
      let parameters = data.paths[pathKey].post?.parameters || [];
      parameters = parameters.filter((arg) => arg.name !== "Authorization");
      data.paths[pathKey].post.parameters = parameters;
    }

    if (data.paths[pathKey].hasOwnProperty("delete")) {
      let parameters = data.paths[pathKey].delete?.parameters || [];
      parameters = parameters.filter((arg) => arg.name !== "Authorization");
      data.paths[pathKey].delete.parameters = parameters;
    }
  }

  const openApiSpec = {
    ...data,
    servers: [
      {
        url: "/api",
      },
    ],
  };
  fs.writeFileSync(outputFile, JSON.stringify(openApiSpec, null, 2), {
    encoding: "utf-8",
    flag: "w",
  });
  console.log(`Swagger-autogen:  \x1b[32mPatched servers.url ✔\x1b[0m`);
});
