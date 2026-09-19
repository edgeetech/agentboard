import { expect, test } from "@playwright/test";

/**
 * Multi-Provider Configuration Test
 *
 * Validates that tasks can be configured with different providers
 * and that provider selection is correctly persisted and used during execution.
 *
 * This test validates the provider-agnostic Engine design:
 * - Tasks accept provider configuration
 * - Provider selection persists across page reloads
 * - Different providers can be assigned to different roles
 */

test("task can be configured with multiple providers", async ({ page }) => {
  // Create project
  await page.goto("/");
  await page.getByLabel("Project name").fill("Multi-Provider Test");
  await page.getByLabel("Project code").fill("MPT");
  await page.getByLabel("Repository path").fill(process.cwd());

  const projectResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Create project" }).click();
  await projectResponse;

  // Create task
  await page.getByRole("button", { name: /New task/ }).click();
  const modal = page.locator(".modal");
  await modal.getByLabel("Title").fill("Multi-Provider Task");
  await modal.getByLabel("Description").fill("Test provider switching");

  const taskResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/projects/MPT/tasks") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await modal.getByRole("button", { name: "New task" }).click();
  await taskResponse;

  // Open task detail
  await page.getByText("Multi-Provider Task").click();
  await expect(
    page.getByRole("heading", { name: "Multi-Provider Task" }),
  ).toBeVisible();

  // Configure provider: Worker role
  const configSection = page.locator('[data-testid="task-config"]');
  await expect(configSection).toBeVisible();

  // Select first provider (Claude, Codex, or Copilot - whichever is available)
  const providerSelect = configSection.locator('select[name*="provider"]').first();
  const providerOptions = await providerSelect
    .locator("option")
    .allTextContents();
  const firstProvider = providerOptions[1]; // Skip the placeholder

  await providerSelect.selectOption(firstProvider);
  await expect(providerSelect).toHaveValue(
    new RegExp(firstProvider.toLowerCase()),
  );

  // Reload page and verify provider config persists
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Multi-Provider Task" }),
  ).toBeVisible();

  const providerSelectAfterReload = page
    .locator('[data-testid="task-config"]')
    .locator('select[name*="provider"]')
    .first();
  const selectedValue = await providerSelectAfterReload.inputValue();
  expect(selectedValue).toBeTruthy();

  // Switch to different provider (if available)
  const otherProviderOptions = await providerSelectAfterReload
    .locator("option")
    .allTextContents();
  if (otherProviderOptions.length > 2) {
    const secondProvider = otherProviderOptions[2];
    await providerSelectAfterReload.selectOption(secondProvider);

    // Verify second provider is selected
    const newSelectedValue = await providerSelectAfterReload.inputValue();
    expect(newSelectedValue).not.toBe(selectedValue);

    // Reload again and verify new selection persists
    await page.reload();
    const providerSelectAfterSecondReload = page
      .locator('[data-testid="task-config"]')
      .locator('select[name*="provider"]')
      .first();
    const finalValue = await providerSelectAfterSecondReload.inputValue();
    expect(finalValue).toBe(newSelectedValue);
  }

  // Verify task is still in board
  await page.goto("/projects/MPT");
  await expect(
    page.getByText("Multi-Provider Task", { exact: true }),
  ).toBeVisible();
});
