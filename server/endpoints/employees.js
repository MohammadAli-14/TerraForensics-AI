const { reqBody, userFromSession, multiUserMode } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { Telemetry } = require("../models/telemetry");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const employeeService = require("../utils/mongoDB/services/employeeService");
const { mongoDB } = require("../utils/mongoDB/connection");

function employeeEndpoints(app) {
  if (!app) return;

  // Middleware to check MongoDB connection
  const checkMongoDB = async (req, res, next) => {
    try {
      if (!mongoDB.isReady()) {
        await mongoDB.connect();
      }

      if (!mongoDB.isReady()) {
        return res.status(503).json({
          success: false,
          error: "MongoDB connection unavailable",
        });
      }
      next();
    } catch (error) {
      console.error("MongoDB connection error:", error);
      res.status(500).json({
        success: false,
        error: "Database connection failed",
      });
    }
  };

  // Get all employees with pagination
  app.get(
    "/employees",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const { page = 1, limit = 20, department, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let result;
        if (search) {
          result = await employeeService.searchEmployees(
            search,
            parseInt(limit)
          );
        } else if (department) {
          result = await employeeService.getEmployeesByDepartment(
            department,
            parseInt(limit)
          );
        } else {
          result = await employeeService.getAllEmployees(parseInt(limit), skip);
        }

        if (!result.success) {
          return res.status(400).json(result);
        }

        res.status(200).json({
          success: true,
          employees: result.employees,
          total: result.total || result.employees.length,
          page: parseInt(page),
          totalPages: result.total
            ? Math.ceil(result.total / parseInt(limit))
            : 1,
        });
      } catch (error) {
        console.error("Error fetching employees:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch employees",
        });
      }
    }
  );

  // Get employee by ID
  app.get(
    "/employees/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const { id } = req.params;
        const result = await employeeService.getEmployeeById(id);

        if (!result.success) {
          return res.status(404).json(result);
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching employee:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch employee",
        });
      }
    }
  );

  // Create new employee
  app.post(
    "/employees",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const employeeData = reqBody(req);
        const result = await employeeService.createEmployee(employeeData);

        if (!result.success) {
          return res.status(400).json(result);
        }

        await EventLogs.logEvent(
          "employee_created",
          {
            employeeId: result.employee.employeeId,
            employeeName: result.employee.name,
          },
          res.locals?.user?.id
        );

        res.status(201).json(result);
      } catch (error) {
        console.error("Error creating employee:", error);
        res.status(500).json({
          success: false,
          error: "Failed to create employee",
        });
      }
    }
  );

  // Update employee
  app.put(
    "/employees/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = reqBody(req);
        const result = await employeeService.updateEmployee(id, updateData);

        if (!result.success) {
          return res.status(400).json(result);
        }

        await EventLogs.logEvent(
          "employee_updated",
          {
            employeeId: result.employee.employeeId,
            employeeName: result.employee.name,
          },
          res.locals?.user?.id
        );

        res.status(200).json(result);
      } catch (error) {
        console.error("Error updating employee:", error);
        res.status(500).json({
          success: false,
          error: "Failed to update employee",
        });
      }
    }
  );

  // Delete employee
  app.delete(
    "/employees/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const { id } = req.params;
        const result = await employeeService.deleteEmployee(id);

        if (!result.success) {
          return res.status(400).json(result);
        }

        await EventLogs.logEvent(
          "employee_deleted",
          {
            employeeId: id,
          },
          res.locals?.user?.id
        );

        res.status(200).json(result);
      } catch (error) {
        console.error("Error deleting employee:", error);
        res.status(500).json({
          success: false,
          error: "Failed to delete employee",
        });
      }
    }
  );

  // Get employee statistics
  app.get(
    "/employees/stats",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const result = await employeeService.getEmployeeStats();

        if (!result.success) {
          return res.status(400).json(result);
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching employee stats:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch employee statistics",
        });
      }
    }
  );

  // Export employees to CSV
  app.get(
    "/employees/export/csv",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      checkMongoDB,
    ],
    async (req, res) => {
      try {
        const result = await employeeService.getAllEmployees(0, 0); // Get all employees

        if (!result.success) {
          return res.status(400).json(result);
        }

        // Convert to CSV
        const employees = result.employees;
        const headers = [
          "Employee ID",
          "Name",
          "Email",
          "Department",
          "Position",
          "Salary",
          "Status",
          "Hire Date",
          "Contact Number",
          "Skills",
        ];

        const csvRows = [
          headers.join(","),
          ...employees.map((emp) =>
            [
              emp.employeeId,
              `"${emp.name}"`,
              emp.email,
              emp.department,
              emp.position,
              emp.salary || "",
              emp.status,
              emp.hireDate
                ? new Date(emp.hireDate).toISOString().split("T")[0]
                : "",
              emp.contactNumber || "",
              `"${(emp.skills || []).join("; ")}"`,
            ].join(",")
          ),
        ];

        const csvContent = csvRows.join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=employees.csv"
        );
        res.status(200).send(csvContent);

        await EventLogs.logEvent(
          "employees_exported",
          {
            format: "csv",
            count: employees.length,
          },
          res.locals?.user?.id
        );
      } catch (error) {
        console.error("Error exporting employees:", error);
        res.status(500).json({
          success: false,
          error: "Failed to export employees",
        });
      }
    }
  );
}

module.exports = { employeeEndpoints };
