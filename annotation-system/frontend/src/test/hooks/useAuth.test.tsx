import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

// Mock apiClient
vi.mock("@/api/client", () => ({
  default: {
    post: vi.fn(),
  },
}));

// Helper component that exposes auth context for testing
function AuthConsumer() {
  const { user, token, loading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? JSON.stringify(user) : "null"}</div>
      <div data-testid="token">{token ?? "null"}</div>
      <button
        data-testid="login-btn"
        onClick={() =>
          login({ email: "test@test.com", password: "pass" })
        }
      >
        Login
      </button>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function renderWithRouter(initialRoute = "/") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider>
        <Routes>
          <Route path="*" element={<AuthConsumer />} />
          <Route path="/admin" element={<div>Admin Page</div>} />
          <Route
            path="/conversation/default"
            element={<div>Conversation Page</div>}
          />
          <Route path="/annotation" element={<div>Annotation Page</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("useAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("starts with loading=true then transitions to false", async () => {
    renderWithRouter();
    // After useEffect runs, loading should become false
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
  });

  it("initially has null user and token when localStorage is empty", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(screen.getByTestId("token").textContent).toBe("null");
  });

  it("restores user and token from localStorage on mount", async () => {
    const storedUser = {
      id: "user-1",
      name: "Test User",
      email: "test@test.com",
      role: "participant",
    };
    localStorage.setItem("token", "stored-token-123");
    localStorage.setItem("user", JSON.stringify(storedUser));

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("token").textContent).toBe("stored-token-123");
    expect(screen.getByTestId("user").textContent).toBe(
      JSON.stringify(storedUser)
    );
  });

  it("handles corrupted localStorage gracefully", async () => {
    localStorage.setItem("token", "some-token");
    localStorage.setItem("user", "not-valid-json{{{");

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should fall back to null after catching JSON parse error
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("sets user and token on successful login and stores in localStorage", async () => {
    const apiClient = (await import("@/api/client")).default;
    const mockedPost = vi.mocked(apiClient.post);
    mockedPost.mockResolvedValue({
      data: {
        access_token: "new-token-456",
        token_type: "bearer",
        user: {
          id: "user-2",
          name: "New User",
          email: "new@test.com",
          role: "participant",
        },
      },
    });

    const user = userEvent.setup();
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await user.click(screen.getByTestId("login-btn"));

    // After login, the component navigates away, so we verify via localStorage
    await waitFor(() => {
      expect(localStorage.getItem("token")).toBe("new-token-456");
      expect(localStorage.getItem("user")).toContain("New User");
    });
  });

  it("clears state on logout and removes from localStorage", async () => {
    const storedUser = {
      id: "user-1",
      name: "Test",
      email: "t@t.com",
      role: "participant",
    };
    localStorage.setItem("token", "my-token");
    localStorage.setItem("user", JSON.stringify(storedUser));

    const user = userEvent.setup();
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("token").textContent).toBe("my-token");
    });

    await user.click(screen.getByTestId("logout-btn"));

    // After logout, navigate to /login, so we verify via localStorage
    await waitFor(() => {
      expect(localStorage.getItem("token")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
    });
  });

  it("navigates researcher to /admin after login", async () => {
    const apiClient = (await import("@/api/client")).default;
    const mockedPost = vi.mocked(apiClient.post);
    mockedPost.mockResolvedValue({
      data: {
        access_token: "token",
        token_type: "bearer",
        user: {
          id: "r-1",
          name: "Researcher",
          email: "r@test.com",
          role: "researcher",
        },
      },
    });

    const user = userEvent.setup();
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => {
      expect(screen.getByText("Admin Page")).toBeInTheDocument();
    });
  });

  it("navigates participant to /conversation/default after login", async () => {
    const apiClient = (await import("@/api/client")).default;
    const mockedPost = vi.mocked(apiClient.post);
    mockedPost.mockResolvedValue({
      data: {
        access_token: "token",
        token_type: "bearer",
        user: {
          id: "p-1",
          name: "Participant",
          email: "p@test.com",
          role: "participant",
        },
      },
    });

    const user = userEvent.setup();
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => {
      expect(screen.getByText("Conversation Page")).toBeInTheDocument();
    });
  });

  it("navigates external_annotator to /annotation after login", async () => {
    const apiClient = (await import("@/api/client")).default;
    const mockedPost = vi.mocked(apiClient.post);
    mockedPost.mockResolvedValue({
      data: {
        access_token: "token",
        token_type: "bearer",
        user: {
          id: "a-1",
          name: "Annotator",
          email: "a@test.com",
          role: "external_annotator",
        },
      },
    });

    const user = userEvent.setup();
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => {
      expect(screen.getByText("Annotation Page")).toBeInTheDocument();
    });
  });

  it("throws error when useAuth is used outside of AuthProvider", () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(
        <MemoryRouter>
          <AuthConsumer />
        </MemoryRouter>
      );
    }).toThrow("useAuth must be used within an AuthProvider");

    consoleSpy.mockRestore();
  });
});
