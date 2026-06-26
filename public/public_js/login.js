document.getElementById("loginSubmit").addEventListener("click", async () => {
  const identifier = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;

  if (!identifier || !password) {
    alert("Please enter both your username and password.");
    return;
  }

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });

    const data = await response.json();

    if (response.ok) {
      alert("Success: " + data.message);
      if (data.role === "admin") {
        window.location.href = "/adminPage.html";
      } else {
        window.location.href = "/patientPage.html";
      }
    } else {
      alert("Error: " + data.error);
    }
  } catch (error) {
    console.error("Error during login:", error);
    alert("An error occurred. Check the console.");
  }
});
