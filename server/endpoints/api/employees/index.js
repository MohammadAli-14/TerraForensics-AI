const { mongoDB } = require("../../../utils/mongoDB/connection");
const employeeService = require("../../../utils/mongoDB/services/employeeService");
const { reqBody } = require("../../../utils/http");
const {
  validatedRequest,
} = require("../../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../../utils/middleware/multiUserProtected");

function employeeEndpoints(app) {
  if (!app) return;

  // Initialize MongoDB connection
  app.use("/api/employees*", async (req, res, next) => {
    await mongoDB.connect();
    next();
  });

  // Get all employees
  app.get(
    "/api/employees",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { limit = 50, page = 1, department, status } = request.query;
        const skip = (page - 1) * limit;

        let query = {};
        if (department) query.department = department;
        if (status) query.status = status;

        // For now, using getAllEmployees. You can enhance the service to accept filters
        const result = await employeeService.getAllEmployees(limit, skip);

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        response.status(200).json({
          employees: result.employees,
          total: result.total,
          page: parseInt(page),
          totalPages: Math.ceil(result.total / limit),
        });
      } catch (error) {
        console.error("Error fetching employees:", error);
        response.status(500).json({ error: "Failed to fetch employees" });
      }
    }
  );

  // Get employee by ID
  app.get(
    "/api/employees/:employeeId",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { employeeId } = request.params;
        const result = await employeeService.getEmployeeById(employeeId);

        if (!result.success) {
          return response.status(404).json({ error: result.error });
        }

        response.status(200).json({ employee: result.employee });
      } catch (error) {
        console.error("Error fetching employee:", error);
        response.status(500).json({ error: "Failed to fetch employee" });
      }
    }
  );

  // Create new employee
  app.post(
    "/api/employees",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const employeeData = reqBody(request);

        // Generate employee ID if not provided
        if (!employeeData.employeeId) {
          const timestamp = Date.now();
          const randomNum = Math.floor(Math.random() * 1000);
          employeeData.employeeId = `EMP${timestamp}${randomNum}`;
        }

        const result = await employeeService.createEmployee(employeeData);

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        response.status(201).json({
          message: "Employee created successfully",
          employee: result.employee,
        });
      } catch (error) {
        console.error("Error creating employee:", error);
        response.status(500).json({ error: "Failed to create employee" });
      }
    }
  );

  // Update employee
  app.put(
    "/api/employees/:employeeId",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { employeeId } = request.params;
        const updateData = reqBody(request);

        const result = await employeeService.updateEmployee(
          employeeId,
          updateData
        );

        if (!result.success) {
          return response.status(404).json({ error: result.error });
        }

        response.status(200).json({
          message: "Employee updated successfully",
          employee: result.employee,
        });
      } catch (error) {
        console.error("Error updating employee:", error);
        response.status(500).json({ error: "Failed to update employee" });
      }
    }
  );

  // Delete employee
  app.delete(
    "/api/employees/:employeeId",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { employeeId } = request.params;
        const result = await employeeService.deleteEmployee(employeeId);

        if (!result.success) {
          return response.status(404).json({ error: result.error });
        }

        response.status(200).json({ message: result.message });
      } catch (error) {
        console.error("Error deleting employee:", error);
        response.status(500).json({ error: "Failed to delete employee" });
      }
    }
  );

  // Search employees
  app.get(
    "/api/employees/search/:query",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { query } = request.params;
        const { limit = 10 } = request.query;

        const result = await employeeService.searchEmployees(
          query,
          parseInt(limit)
        );

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        response.status(200).json({
          employees: result.employees,
          count: result.employees.length,
        });
      } catch (error) {
        console.error("Error searching employees:", error);
        response.status(500).json({ error: "Failed to search employees" });
      }
    }
  );

  // Get employee statistics
  app.get(
    "/api/employees/stats/summary",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const result = await employeeService.getEmployeeStats();

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        response.status(200).json({ stats: result.stats });
      } catch (error) {
        console.error("Error getting employee stats:", error);
        response
          .status(500)
          .json({ error: "Failed to get employee statistics" });
      }
    }
  );

  // Bulk import employees
  app.post(
    "/api/employees/bulk-import",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { employees } = reqBody(request);

        if (!Array.isArray(employees) || employees.length === 0) {
          return response.status(400).json({ error: "No employees provided" });
        }

        const results = [];
        const errors = [];

        for (const empData of employees) {
          try {
            // Generate employee ID if not provided
            if (!empData.employeeId) {
              const timestamp = Date.now();
              const randomNum = Math.floor(Math.random() * 1000);
              empData.employeeId = `EMP${timestamp}${randomNum}`;
            }

            const result = await employeeService.createEmployee(empData);
            if (result.success) {
              results.push(result.employee);
            } else {
              errors.push({ employee: empData, error: result.error });
            }
          } catch (error) {
            errors.push({ employee: empData, error: error.message });
          }
        }

        response.status(200).json({
          message: `Import completed. Success: ${results.length}, Failed: ${errors.length}`,
          imported: results,
          errors: errors,
        });
      } catch (error) {
        console.error("Error in bulk import:", error);
        response.status(500).json({ error: "Failed to import employees" });
      }
    }
  );
}

module.exports = { employeeEndpoints };
