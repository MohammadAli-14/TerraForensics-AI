import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Employee = {
  // Get all employees with pagination
  getAll: async function (page = 1, limit = 20, filters = {}) {
    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters,
    });

    return await fetch(`${API_BASE}/employees?${queryParams}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error fetching employees:", error);
        return { success: false, error: error.message };
      });
  },

  // Get employee by ID
  getById: async function (id) {
    return await fetch(`${API_BASE}/employees/${id}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error fetching employee:", error);
        return { success: false, error: error.message };
      });
  },

  // Create new employee
  create: async function (employeeData) {
    return await fetch(`${API_BASE}/employees`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(employeeData),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error creating employee:", error);
        return { success: false, error: error.message };
      });
  },

  // Update employee
  update: async function (id, employeeData) {
    return await fetch(`${API_BASE}/employees/${id}`, {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify(employeeData),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error updating employee:", error);
        return { success: false, error: error.message };
      });
  },

  // Delete employee
  delete: async function (id) {
    return await fetch(`${API_BASE}/employees/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error deleting employee:", error);
        return { success: false, error: error.message };
      });
  },

  // Get statistics
  getStats: async function () {
    return await fetch(`${API_BASE}/employees/stats`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error fetching stats:", error);
        return { success: false, error: error.message };
      });
  },

  // Export to CSV
  exportToCSV: async function () {
    return await fetch(`${API_BASE}/employees/export/csv`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "employees.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return { success: true };
      })
      .catch((error) => {
        console.error("Error exporting employees:", error);
        return { success: false, error: error.message };
      });
  },

  // Search employees
  search: async function (query, limit = 10) {
    return await fetch(
      `${API_BASE}/employees?search=${encodeURIComponent(query)}&limit=${limit}`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error searching employees:", error);
        return { success: false, error: error.message };
      });
  },
};

export default Employee;
