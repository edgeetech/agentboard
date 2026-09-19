import { expect, test } from "@playwright/test";

test("loads the first-run board and creates a task", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("AgentBoard");
  await expect(
    page.getByRole("heading", { name: "Create your first project" }),
  ).toBeVisible();

  await page.getByLabel("Project name").fill("E2E Characterization");
  await page.getByLabel("Project code").fill("E2E");
  await page.getByLabel("Repository path").fill(process.cwd());

  const projectResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Create project" }).click();
  await projectResponse;

  await expect(page).toHaveURL(/\/projects\/E2E$/);
  await expect(
    page.getByRole("heading", { name: /E2E Characterization E2E/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /New task/ }).click();
  const modal = page.locator(".modal");
  await expect(modal.getByRole("heading", { name: "New task" })).toBeVisible();
  await modal.getByLabel("Title").fill("Characterization task");
  await modal
    .getByLabel("Description")
    .fill("Created by Playwright characterization.");

  const taskResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects/E2E/tasks") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await modal.getByRole("button", { name: "New task" }).click();
  await taskResponse;

  await expect(modal).toBeHidden();
  await expect(
    page.getByText("Characterization task", { exact: true }),
  ).toBeVisible();
});
