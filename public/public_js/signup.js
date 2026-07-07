document.getElementById("signUpSubmit").addEventListener("click", async () => {
  const firstName = document.querySelector('input[name="firstName"]').value;
  const lastName = document.querySelector('input[name="lastName"]').value;
  const username = document.querySelector('input[name="username"]').value;
  const email = document.querySelector('input[name="email"]').value;
  const password = document.querySelector('input[name="password"]').value;
  const contactNumber = document.querySelector(
    'input[name="contactNumber"]',
  ).value;

  if (
    !firstName ||
    !lastName ||
    !username ||
    !email ||
    !password ||
    !contactNumber
  ) {
    alert("Please fill in all fields.");
    return;
  }

  try {
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        firstName,
        lastName,
        username,
        email,
        password,
        contactNumber,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      alert("Success: " + data.message);
      window.location.href = "/login.html";
    } else {
      alert("Error: " + data.error);
    }
  } catch (error) {
    console.error("Error during signup:", error);
    alert("An error occurred while signing up. Check the console.");
  }
});
